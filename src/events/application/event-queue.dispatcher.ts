import {
	Inject,
	Injectable,
	Logger,
	OnApplicationBootstrap,
} from '@nestjs/common';
import { DomainEvent } from 'src/events/domain/domain-event';
import {
	EVENT_SUBSCRIBER,
	EventSubscriber,
} from './ports/event-subscriber.port';
import { EVENT_QUEUE, EventQueue } from './ports/event-queue.port';

/**
 * A costura entre o barramento e a fila (TRA-136, fase 2).
 *
 * Assina TUDO (`**`) no barramento in-process e nao faz nada alem de
 * enfileirar. E deliberado: chamada ao trackerr-ia, envio de e-mail e push
 * sao trabalho pesado e falivel; no caminho do request eles atrasariam a
 * resposta e morreriam com ela. Enfileirar custa um round-trip no Redis.
 *
 * Repare que este arquivo — que e o que de fato liga transporte a
 * durabilidade — depende so das duas portas. Nem `@nestjs/event-emitter`
 * nem `bullmq` aparecem aqui.
 */
@Injectable()
export class EventQueueDispatcher implements OnApplicationBootstrap {
	private readonly logger = new Logger(EventQueueDispatcher.name);

	constructor(
		@Inject(EVENT_SUBSCRIBER) private readonly subscriber: EventSubscriber,
		@Inject(EVENT_QUEUE) private readonly queue: EventQueue
	) {}

	onApplicationBootstrap(): void {
		this.subscriber.subscribe('**', (event) => this.dispatch(event));
	}

	/**
	 * Nunca lanca. Uma falha aqui viraria excecao dentro de `publish()`, e o
	 * criterio de aceite diz o contrario: "Redis indisponivel nao derruba o
	 * request que publicou o evento". O InProcessEventBus tambem protege —
	 * cinto e suspensorio, porque este e o caminho critico.
	 */
	async dispatch(event: DomainEvent): Promise<void> {
		try {
			const result = await this.queue.enqueue(event);

			if (result.outcome === 'duplicate') {
				this.logger.debug(
					`Evento ${event.type} id=${event.id} ja enfileirado — ignorado`
				);
				return;
			}

			if (result.outcome === 'unavailable') {
				// Warn, nao error: o evento foi publicado com sucesso e o
				// dominio seguiu. O que se perdeu foi a entrega assincrona.
				this.logger.warn(
					`Fila indisponivel para ${event.type} id=${event.id}: ${result.error ?? 'motivo nao informado'}`
				);
				return;
			}

			this.logger.debug(
				`Evento ${event.type} id=${event.id} enfileirado (job=${result.jobId})`
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(
				`Falha inesperada ao enfileirar ${event.type} id=${event.id}: ${message}`
			);
		}
	}
}
