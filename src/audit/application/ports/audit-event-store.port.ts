import {
	SealedAuditEvent,
	StoredAuditEvent,
} from 'src/audit/domain/audit-event';

export interface AuditChainHead {
	seq: number;
	hash: string;
}

/**
 * Persistência da trilha (ADR-004, seção 9.3). Quem implementa nunca atualiza
 * nem apaga um evento: a única escrita sobre um evento existente é o selo,
 * uma vez, enquanto ele ainda está pendente.
 */
export interface AuditEventStore {
	insertPending(event: StoredAuditEvent): Promise<void>;
	/** Pendentes na ordem em que chegaram. */
	findPending(limit: number): Promise<StoredAuditEvent[]>;
	/** Grava o selo só se o evento ainda estiver pendente. `false` se outro selou antes. */
	seal(
		eventId: string,
		seal: { seq: number; prevHash: string; hash: string; sealedAt: Date }
	): Promise<boolean>;
	/** Selados com `seq` maior que `afterSeq`, em ordem. */
	findSealedAfter(afterSeq: number, limit: number): Promise<SealedAuditEvent[]>;
	findSealedBySeq(seq: number): Promise<SealedAuditEvent | null>;
	findLastSealed(): Promise<SealedAuditEvent | null>;
	countPending(): Promise<number>;

	/**
	 * Concessão para selar: só uma instância por vez, com validade, para a
	 * ordem da cadeia não depender de sorte. `null` quando outra detém.
	 */
	tryAcquireLease(
		owner: string,
		now: Date,
		leaseMs: number
	): Promise<AuditChainHead | null>;
	advanceHead(owner: string, head: AuditChainHead): Promise<void>;
	releaseLease(owner: string): Promise<void>;
	findHead(): Promise<AuditChainHead | null>;
}

export const AUDIT_EVENT_STORE = Symbol('AUDIT_EVENT_STORE');
