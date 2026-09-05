import { DomainEvent } from 'src/events/domain/domain-event';

/**
 * Consumidor de evento executado pelo worker da fila.
 *
 * Contrato obrigatorio: `handle` e IDEMPOTENTE. Em qualquer transporte
 * distribuido — e tambem em retry de fila — o mesmo evento pode chegar duas
 * vezes. A deduplicacao por `jobId` do BullMQ cobre reemissao do mesmo
 * `event.id`, mas nao cobre um retry que morreu depois do efeito colateral.
 *
 * Lancar dentro de `handle` sinaliza falha ao worker, que aplica o backoff
 * e, esgotadas as tentativas, manda o envelope para a dead-letter.
 */
export interface EventConsumer {
	/** Nome para log e para a bull-board. */
	readonly name: string;
	/** Padrao de evento que este consumidor atende. Ver matchesEventPattern. */
	readonly pattern: string;
	handle(event: DomainEvent): Promise<void>;
}

/**
 * Lista de consumidores injetada no worker. Comeca vazia: os produtores dos
 * cinco eventos de dominio chegam na fase 3 da TRA-136.
 */
export const EVENT_CONSUMERS = Symbol('EVENT_CONSUMERS');
