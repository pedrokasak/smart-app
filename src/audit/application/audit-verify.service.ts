import { Inject, Injectable } from '@nestjs/common';
import { verifyChain } from 'src/audit/domain/audit-chain';
import { GENESIS_HASH, SealedAuditEvent } from 'src/audit/domain/audit-event';
import {
	AUDIT_EVENT_STORE,
	AuditEventStore,
} from './ports/audit-event-store.port';

const BATCH = 500;

export interface AuditVerificationResult {
	ok: boolean;
	/** Primeiro e último `seq` conferidos. */
	fromSeq: number;
	toSeq: number | null;
	checked: number;
	/** Eventos ainda sem selo: esperam o selador e não entram na conta. */
	pending: number;
	head: { seq: number; hash: string } | null;
	firstBroken: { seq: number; eventId: string; reason: string } | null;
}

/**
 * Recalcula a cadeia e aponta o primeiro elo quebrado (ADR-004, seção 9.3).
 * Leitura em lotes: a cadeia inteira nunca fica na memória.
 */
@Injectable()
export class AuditVerifyService {
	constructor(
		@Inject(AUDIT_EVENT_STORE) private readonly store: AuditEventStore
	) {}

	async verify(
		options: { fromSeq?: number; toSeq?: number } = {}
	): Promise<AuditVerificationResult> {
		const fromSeq = Math.max(1, options.fromSeq ?? 1);
		const toSeq = options.toSeq ?? null;

		// O hash esperado antes do trecho vem do próprio evento anterior; só a
		// cadeia inteira parte do elo zero.
		let prevHash = GENESIS_HASH;
		if (fromSeq > 1) {
			const before = await this.store.findSealedBySeq(fromSeq - 1);
			if (!before) {
				return this.result({
					ok: false,
					fromSeq,
					toSeq,
					checked: 0,
					firstBroken: { seq: fromSeq - 1, eventId: '', reason: 'seq_gap' },
				});
			}
			prevHash = before.hash;
		}

		let expectedSeq = fromSeq;
		let checked = 0;
		let afterSeq = fromSeq - 1;

		for (;;) {
			let batch = await this.store.findSealedAfter(afterSeq, BATCH);
			if (toSeq !== null) batch = batch.filter((event) => event.seq <= toSeq);
			if (!batch.length) break;

			const verdict = verifyChain(batch, expectedSeq, prevHash);
			checked += verdict.checked;
			if (!verdict.ok) {
				return this.result({
					ok: false,
					fromSeq,
					toSeq,
					checked,
					firstBroken: verdict.firstBroken,
				});
			}

			const last: SealedAuditEvent = batch[batch.length - 1];
			prevHash = last.hash;
			expectedSeq = last.seq + 1;
			afterSeq = last.seq;
			if (batch.length < BATCH) break;
		}

		return this.result({
			ok: true,
			fromSeq,
			toSeq,
			checked,
			firstBroken: null,
		});
	}

	private async result(
		partial: Pick<
			AuditVerificationResult,
			'ok' | 'fromSeq' | 'toSeq' | 'checked' | 'firstBroken'
		>
	): Promise<AuditVerificationResult> {
		const [pending, last] = await Promise.all([
			this.store.countPending(),
			this.store.findLastSealed(),
		]);
		return {
			...partial,
			pending,
			head: last ? { seq: last.seq, hash: last.hash } : null,
		};
	}
}
