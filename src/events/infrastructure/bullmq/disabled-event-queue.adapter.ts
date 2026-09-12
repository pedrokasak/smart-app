import { Injectable, Logger } from '@nestjs/common';
import { DomainEvent } from 'src/events/domain/domain-event';
import {
	EnqueueResult,
	EventQueue,
} from 'src/events/application/ports/event-queue.port';

/**
 * Implementacao da porta EventQueue para quando a fila esta desligada
 * (`EVENTS_QUEUE_ENABLED=false`, ou ambiente de teste).
 *
 * Existe para que o resto do grafo nao precise saber que a fila sumiu:
 * o dispatcher continua chamando a porta, o barramento in-process continua
 * publicando, e nenhuma conexao com Redis e aberta. Null object, nao
 * `undefined` espalhado por if.
 */
@Injectable()
export class DisabledEventQueueAdapter implements EventQueue {
	private readonly logger = new Logger(DisabledEventQueueAdapter.name);

	async enqueue<T>(event: DomainEvent<T>): Promise<EnqueueResult> {
		this.logger.debug(
			`Fila desligada — ${event.type} id=${event.id} nao foi enfileirado`
		);
		return {
			outcome: 'unavailable',
			error: 'fila de eventos desligada (EVENTS_QUEUE_ENABLED=false)',
		};
	}
}
