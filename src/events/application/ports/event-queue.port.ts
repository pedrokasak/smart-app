import { DomainEvent } from 'src/events/domain/domain-event';

/**
 * Resultado do enfileiramento. Nunca e excecao: a fila e um detalhe de
 * durabilidade, e o request que publicou o evento nao pode cair porque o
 * Redis esta fora do ar (criterio de aceite da TRA-136).
 *
 *   enqueued    — job criado
 *   duplicate   — ja existe job com este `event.id` (deduplicacao nativa)
 *   unavailable — fila indisponivel (Redis fora, timeout, fila desligada)
 */
export type EnqueueOutcome = 'enqueued' | 'duplicate' | 'unavailable';

export interface EnqueueResult {
	outcome: EnqueueOutcome;
	/** Id do job na fila. Por contrato, igual a `event.id`. */
	jobId?: string;
	/** Preenchido apenas em `unavailable`. */
	error?: string;
}

/**
 * Porta de durabilidade. O assinante do barramento nao executa trabalho
 * pesado — ele enfileira, e o worker consome depois. Assim o request fica
 * rapido e o trabalho fica duravel.
 */
export interface EventQueue {
	enqueue<T>(event: DomainEvent<T>): Promise<EnqueueResult>;
}

export const EVENT_QUEUE = Symbol('EVENT_QUEUE');
