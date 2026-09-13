import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { DomainEvent } from 'src/events/domain/domain-event';
import {
	EnqueueResult,
	EventQueue,
} from 'src/events/application/ports/event-queue.port';
import {
	EVENT_QUEUE_CONFIG,
	EventQueueConfig,
} from 'src/events/infrastructure/bullmq/queue.config';

/**
 * Adaptador duravel da porta EventQueue sobre BullMQ + Redis (TRA-136).
 *
 * Deduplicacao: usa o `jobId` NATIVO do BullMQ, com `event.id` como valor.
 * Adicionar um job com jobId ja existente e no-op no Redis — nao ha janela
 * de corrida em que dois jobs iguais entrem. E o que atende ao criterio
 * "reprocessar o mesmo event.id duas vezes nao gera notificacao duplicada",
 * sem a consulta ao Mongo que a deduplicacao manual da #134 faz. A janela
 * de deducao e a retencao do job concluido (24h por default), calibrada
 * para bater com DEDUPE_WINDOW_HOURS.
 *
 * Degradacao: `enqueue` NUNCA lanca. Redis fora do ar vira
 * `outcome: 'unavailable'`, o chamador loga e o request que publicou o
 * evento responde normalmente.
 */
@Injectable()
export class BullmqEventQueueAdapter implements EventQueue, OnModuleDestroy {
	private readonly logger = new Logger(BullmqEventQueueAdapter.name);
	private readonly connection?: Redis;
	private readonly queue?: Queue;
	private readonly deadLetterQueue?: Queue;

	constructor(
		@Inject(EVENT_QUEUE_CONFIG) private readonly config: EventQueueConfig
	) {
		// O provider existe no grafo mesmo com a fila desligada — o worker e a
		// bull-board referenciam esta classe por token. Com `enabled: false`
		// (ambiente de teste, ou EVENTS_QUEUE_ENABLED=false) nenhuma conexao e
		// aberta, e quem implementa a porta e o DisabledEventQueueAdapter.
		if (!this.config.enabled) return;

		// Conexao SO do produtor, separada da do worker de proposito:
		//   - `enableOfflineQueue: false` faz o comando falhar na hora quando
		//     o Redis esta fora, em vez de empilhar em memoria e resolver
		//     minutos depois — o request nao pode esperar por isso.
		//   - `maxRetriesPerRequest: 1` limita o retry interno do ioredis; o
		//     retry de verdade e do BullMQ, no consumo.
		// O worker precisa do oposto (bloqueante, sem teto de retry), por
		// isso ele abre a propria conexao.
		this.connection = new Redis({
			...this.config.connection,
			enableOfflineQueue: false,
			maxRetriesPerRequest: 1,
			lazyConnect: true,
			retryStrategy: (tentativas) => Math.min(tentativas * 500, 10_000),
		});

		this.connection.on('error', (err) => {
			// Sem handler o ioredis emite 'error' como unhandled e derruba o
			// processo. Redis fora do ar e um estado degradado, nao fatal.
			this.logger.warn(`Conexao Redis (produtor): ${err.message}`);
		});

		this.connection.connect().catch((err: Error) => {
			this.logger.warn(`Redis indisponivel no boot: ${err.message}`);
		});

		const shared = { connection: this.connection };
		this.queue = new Queue(this.config.queueName, shared);
		this.deadLetterQueue = new Queue(this.config.deadLetterQueueName, shared);
	}

	async enqueue<T>(event: DomainEvent<T>): Promise<EnqueueResult> {
		const queue = this.queue;
		if (!queue) {
			return { outcome: 'unavailable', error: 'fila de eventos desligada' };
		}

		try {
			const existente = await this.comTimeout(queue.getJob(event.id));
			if (existente) {
				return { outcome: 'duplicate', jobId: event.id };
			}

			const job = await this.comTimeout(
				queue.add(event.type, event, {
					// A deduplicacao. `event.id` vem do produtor, entao a mesma
					// ocorrencia de dominio sempre gera o mesmo jobId — mesmo se
					// o evento for republicado por outro processo.
					jobId: event.id,
					attempts: this.config.attempts,
					backoff: { type: 'exponential', delay: this.config.backoffMs },
					removeOnComplete: {
						age: this.config.keepCompletedSeconds,
						count: this.config.keepCompletedCount,
					},
					// Falha fica retida para inspecao na bull-board; a copia
					// canonica do que falhou de vez vai para a dead-letter.
					removeOnFail: { age: this.config.keepFailedSeconds },
				})
			);

			return { outcome: 'enqueued', jobId: job.id ?? event.id };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { outcome: 'unavailable', error: message };
		}
	}

	/**
	 * Filas expostas para observabilidade (bull-board). Retorna as instancias
	 * do BullMQ de proposito: quem consome isto e o painel administrativo,
	 * que e infraestrutura — nao ha dominio do outro lado.
	 */
	observableQueues(): Queue[] {
		return [this.queue, this.deadLetterQueue].filter(
			(q): q is Queue => q !== undefined
		);
	}

	/**
	 * Fila terminal. Sem worker: o job fica parado ate alguem olhar na
	 * bull-board e decidir reprocessar. Perder o evento em silencio seria
	 * pior que acumular.
	 */
	async sendToDeadLetter(
		event: DomainEvent,
		reason: string,
		attemptsMade: number
	): Promise<void> {
		const deadLetter = this.deadLetterQueue;
		if (!deadLetter) return;

		try {
			await this.comTimeout(
				deadLetter.add(
					event.type,
					{ event, reason, attemptsMade, failedAt: new Date().toISOString() },
					{
						jobId: event.id,
						removeOnComplete: false,
						removeOnFail: false,
					}
				)
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(
				`Falha ao mandar ${event.type} id=${event.id} para a dead-letter: ${message}`
			);
		}
	}

	/**
	 * Um Redis alcancavel mas travado (particao de rede, failover) nao
	 * devolve erro — so nao responde. Sem teto de espera, o request que
	 * publicou o evento ficaria pendurado junto.
	 */
	private comTimeout<R>(operacao: Promise<R>): Promise<R> {
		return Promise.race([
			operacao,
			new Promise<never>((_, reject) =>
				setTimeout(
					() =>
						reject(
							new Error(`timeout de ${this.config.enqueueTimeoutMs}ms no Redis`)
						),
					this.config.enqueueTimeoutMs
				).unref()
			),
		]);
	}

	async onModuleDestroy(): Promise<void> {
		await Promise.allSettled([
			this.queue?.close(),
			this.deadLetterQueue?.close(),
		]);
		this.connection?.disconnect();
	}
}
