import { randomUUID } from 'node:crypto';
import { DomainEvent } from './domain-event';
import {
	DOMAIN_EVENT_VERSIONS,
	DomainEventPayloadMap,
	DomainEventType,
} from './event-types';

export interface CreateDomainEventInput<T extends DomainEventType> {
	type: T;
	/** userId. Vira chave de particao quando o transporte sair do processo. */
	subject: string;
	producer: string;
	payload: DomainEventPayloadMap[T];
	/** Default: versao registrada em DOMAIN_EVENT_VERSIONS. */
	version?: number;
	/** Default: agora. Informar quando o fato ocorreu antes da publicacao. */
	occurredAt?: Date | string;
	correlationId?: string;
	causationId?: string;
	/**
	 * Escape hatch para o outbox e para reprocessamento controlado: permite
	 * reemitir o MESMO id ja persistido. Fora disso, deixe o factory gerar.
	 */
	id?: string;
}

/**
 * Unico caminho suportado para construir um evento. Existe para que o
 * produtor nao consiga esquecer `id` e `occurredAt` — os dois campos dos
 * quais dependem, respectivamente, a idempotencia e a ordenacao.
 */
export function createDomainEvent<T extends DomainEventType>(
	input: CreateDomainEventInput<T>
): DomainEvent<DomainEventPayloadMap[T]> {
	const occurredAt =
		input.occurredAt instanceof Date
			? input.occurredAt.toISOString()
			: (input.occurredAt ?? new Date().toISOString());

	return {
		id: input.id ?? randomUUID(),
		type: input.type,
		version: input.version ?? DOMAIN_EVENT_VERSIONS[input.type],
		occurredAt,
		producer: input.producer,
		subject: input.subject,
		...(input.correlationId ? { correlationId: input.correlationId } : {}),
		...(input.causationId ? { causationId: input.causationId } : {}),
		payload: input.payload,
	};
}
