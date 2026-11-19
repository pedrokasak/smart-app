import { createHash } from 'crypto';
import { canonicalize } from './canonical-json';

/** Elo anterior ao primeiro evento. */
export const GENESIS_HASH = '0'.repeat(64);

export const sha256 = (text: string): string =>
	createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * O que um produtor entrega à trilha (envelope no estilo CloudEvents, como
 * os eventos de domínio do projeto). Só ids opacos e pseudônimos: o dado
 * pessoal fica fora do hash (ADR-004, seção 8.5).
 */
export interface AuditEventInput {
	/** Gerado pelo produtor, para o registro dele apontar para o evento. */
	eventId: string;
	/** `<contexto>.<agregado>.<fato-no-passado>`, ex.: `agent.control.changed`. */
	type: string;
	version: number;
	/** Do que o evento trata, ex.: o id do agente. */
	subject: string;
	/** `userRef` (HMAC) de quem fez, nunca o e-mail. */
	actorRef: string;
	occurredAt: Date;
	/** Conteúdo do evento. Entra na trilha só pelo hash (`payloadHash`). */
	payload: Record<string, unknown>;
}

export interface StoredAuditEvent extends AuditEventInput {
	payloadHash: string;
	/** `null` enquanto pendente: a ordem só existe depois do selo. */
	seq: number | null;
	prevHash: string | null;
	hash: string | null;
	createdAt: Date;
	sealedAt: Date | null;
}

export type SealedAuditEvent = StoredAuditEvent & {
	seq: number;
	prevHash: string;
	hash: string;
};

export function hashPayload(payload: Record<string, unknown>): string {
	return sha256(canonicalize(payload));
}

/**
 * Hash do elo: cobre todo o envelope, o hash do conteúdo, a posição e o elo
 * anterior. Mudar qualquer campo de um evento, ou trocar a ordem de dois,
 * muda este hash e todos os seguintes.
 */
export function computeEventHash(
	event: Pick<
		StoredAuditEvent,
		| 'eventId'
		| 'type'
		| 'version'
		| 'subject'
		| 'actorRef'
		| 'occurredAt'
		| 'payloadHash'
	>,
	seq: number,
	prevHash: string
): string {
	return sha256(
		canonicalize({
			eventId: event.eventId,
			type: event.type,
			version: event.version,
			subject: event.subject,
			actorRef: event.actorRef,
			occurredAt: event.occurredAt,
			payloadHash: event.payloadHash,
			seq,
			prevHash,
		})
	);
}

export function isSealed(event: StoredAuditEvent): event is SealedAuditEvent {
	return event.seq !== null && event.hash !== null && event.prevHash !== null;
}
