import { SealedAuditEvent, computeEventHash, hashPayload } from './audit-event';

export type ChainBreakReason =
	/** Faltou ou sobrou número na sequência: evento apagado ou inserido. */
	| 'seq_gap'
	/** O elo anterior gravado não é o hash do evento anterior. */
	| 'prev_hash'
	/** O conteúdo guardado não bate com o hash do conteúdo. */
	| 'payload_hash'
	/** O hash gravado não bate com o recalculado: algum campo foi alterado. */
	| 'hash';

export interface ChainBreak {
	seq: number;
	eventId: string;
	reason: ChainBreakReason;
}

export interface ChainVerification {
	ok: boolean;
	checked: number;
	firstBroken: ChainBreak | null;
}

/**
 * Confere uma sequência de eventos selados, em ordem de `seq`. Pura: recebe
 * o hash esperado antes do primeiro e devolve o primeiro elo quebrado.
 *
 * Vale para a cadeia inteira (`expectedPrevHash` = GENESIS) ou para um
 * trecho (o hash do evento anterior ao trecho, lido da própria base).
 */
export function verifyChain(
	events: SealedAuditEvent[],
	expectedFirstSeq: number,
	expectedPrevHash: string
): ChainVerification {
	let seq = expectedFirstSeq;
	let prevHash = expectedPrevHash;

	for (const event of events) {
		const broken = (reason: ChainBreakReason): ChainVerification => ({
			ok: false,
			checked: seq - expectedFirstSeq,
			firstBroken: { seq: event.seq, eventId: event.eventId, reason },
		});

		if (event.seq !== seq) return broken('seq_gap');
		if (event.prevHash !== prevHash) return broken('prev_hash');
		if (hashPayload(event.payload) !== event.payloadHash) {
			return broken('payload_hash');
		}
		if (computeEventHash(event, event.seq, event.prevHash) !== event.hash) {
			return broken('hash');
		}

		prevHash = event.hash;
		seq += 1;
	}

	return { ok: true, checked: events.length, firstBroken: null };
}
