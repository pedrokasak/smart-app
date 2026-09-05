import { DomainEvent } from 'src/events/domain/domain-event';

/**
 * Unica dependencia de um produtor de evento.
 *
 * Publicar NAO pode depender de infraestrutura externa: se o Redis cair, o
 * request que publicou o evento continua respondendo 2xx. Quem quiser
 * durabilidade assina o barramento e enfileira (ver EventQueuePort).
 */
export interface EventPublisher {
	publish<T>(event: DomainEvent<T>): Promise<void>;
}

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
