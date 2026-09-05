import {
	Inject,
	Injectable,
	Logger,
	OnApplicationBootstrap,
	OnModuleDestroy,
	Optional,
} from '@nestjs/common';
import { Job, UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { DomainEvent } from 'src/events/domain/domain-event';
import {
	assertDomainEvent,
	InvalidDomainEventError,
} from 'src/events/domain/domain-event.contract';
import { matchesEventPattern } from 'src/events/domain/event-pattern';
import {
	EVENT_CONSUMERS,
	EventConsumer,
} from 'src/events/application/ports/event-consumer.port';
import {
	EVENT_QUEUE_CONFIG,
	EventQueueConfig,
} from 'src/events/infrastructure/bullmq/queue.config';
import { BullmqEventQueueAdapter } from 'src/events/infrastructure/bullmq/bullmq-event-queue.adapter';

/**
 * Worker da fila duravel (TRA-136, fase 2).
 *
 * Aqui e onde o trabalho pesado acontece — fora do caminho do request.
 * Resolve os consumidores pelo padrao do evento e executa cada um. O
 * roteamento usa `matchesEventPattern`, do dominio, e nao o do
 * EventEmitter2: a semantica de "quem escuta o que" nao pode mudar quando
 * o transporte mudar.
 *
 * Politica de falha:
 *   - envelope invalido -> UnrecoverableError (nao adianta repetir), vai
 *     direto para a dead-letter;
 *   - consumidor que lanca -> retry com backoff exponencial;
 *   - tentativas esgotadas -> dead-letter, com motivo e contagem.
 *
 * Nenhum consumidor esta registrado ainda: os produtores dos cinco eventos
 * de dominio chegam na fase 3. A maquinaria e provada por teste.
 */
@Injectable()
export class EventQueueWorker
	implements OnApplicationBootstrap, OnModuleDestroy
{
	private readonly logger = new Logger(EventQueueWorker.name);
	private worker?: Worker;
	private connection?: Redis;

	constructor(
		@Inject(EVENT_QUEUE_CONFIG) private readonly config: EventQueueConfig,
		private readonly queueAdapter: BullmqEventQueueAdapter,
		@Optional()
		@Inject(EVENT_CONSUMERS)
		private readonly consumers: EventConsumer[] = []
	) {}

	onApplicationBootstrap(): void {
		if (!this.config.enabled || !this.config.workerEnabled) {
			this.logger.log(
				'Worker de eventos desligado (EVENTS_QUEUE_WORKER_ENABLED=false)'
			);
			return;
		}

		// Conexao propria: o BullMQ usa comandos bloqueantes (BRPOPLPUSH) e
		// exige `maxRetriesPerRequest: null`. E o oposto do que o produtor
		// quer — por isso as duas conexoes nao sao compartilhadas.
		this.connection = new Redis({
			...this.config.connection,
			maxRetriesPerRequest: null,
		});
		this.connection.on('error', (err) => {
			this.logger.warn(`Conexao Redis (worker): ${err.message}`);
		});

		this.worker = new Worker(
			this.config.queueName,
			(job) => this.process(job),
			{
				connection: this.connection,
				concurrency: this.config.concurrency,
				limiter: {
					max: this.config.rateLimit.max,
					duration: this.config.rateLimit.durationMs,
				},
			}
		);

		this.worker.on('failed', (job, err) => {
			void this.onFailed(job, err);
		});

		this.logger.log(
			`Worker de eventos ativo em '${this.config.queueName}' ` +
				`(concorrencia=${this.config.concurrency}, ` +
				`tentativas=${this.config.attempts}, ` +
				`consumidores=${this.consumers.length})`
		);
	}

	/**
	 * Publica para permitir teste unitario sem Redis: o processamento e
	 * regra, a fila e transporte.
	 */
	async process(job: Pick<Job, 'id' | 'data'>): Promise<void> {
		const event = this.parse(job);
		const alvos = this.consumers.filter((c) =>
			matchesEventPattern(c.pattern, event.type)
		);

		if (alvos.length === 0) {
			this.logger.debug(
				`Nenhum consumidor para ${event.type} id=${event.id} — job concluido`
			);
			return;
		}

		for (const consumidor of alvos) {
			await consumidor.handle(event);
		}
	}

	private parse(job: Pick<Job, 'id' | 'data'>): DomainEvent {
		try {
			assertDomainEvent(job.data);
			return job.data;
		} catch (err) {
			if (err instanceof InvalidDomainEventError) {
				// Repetir um envelope malformado da o mesmo resultado cinco
				// vezes. Falha terminal, direto para a dead-letter.
				throw new UnrecoverableError(err.message);
			}
			throw err;
		}
	}

	private async onFailed(job: Job | undefined, err: Error): Promise<void> {
		if (!job) return;

		const esgotou =
			err instanceof UnrecoverableError ||
			job.attemptsMade >= (job.opts.attempts ?? this.config.attempts);

		this.logger.error(
			`Job ${job.id} (${job.name}) falhou na tentativa ` +
				`${job.attemptsMade}/${job.opts.attempts ?? this.config.attempts}: ${err.message}`
		);

		if (!esgotou) return;

		const event = job.data as DomainEvent;
		if (!event?.id) {
			this.logger.error(
				`Job ${job.id} esgotou tentativas mas nao carrega envelope valido — sem dead-letter`
			);
			return;
		}

		await this.queueAdapter.sendToDeadLetter(
			event,
			err.message,
			job.attemptsMade
		);
		this.logger.error(
			`Evento ${event.type} id=${event.id} movido para a dead-letter`
		);
	}

	async onModuleDestroy(): Promise<void> {
		await this.worker?.close();
		this.connection?.disconnect();
	}
}
