import {
	GENESIS_HASH,
	SealedAuditEvent,
	StoredAuditEvent,
	isSealed,
} from 'src/audit/domain/audit-event';
import {
	AuditChainHead,
	AuditEventListQuery,
	AuditEventStore,
} from './ports/audit-event-store.port';

/** Store em memória para os testes da trilha, com a mesma concessão do Mongo. */
export class InMemoryAuditEventStore implements AuditEventStore {
	readonly events: StoredAuditEvent[] = [];
	head: AuditChainHead & {
		leaseOwner: string | null;
		leaseUntil: Date | null;
	} = { seq: 0, hash: GENESIS_HASH, leaseOwner: null, leaseUntil: null };
	/** Simula a queda entre gravar o selo e avançar o ponteiro. */
	failAdvanceOnce = false;

	async insertPending(event: StoredAuditEvent): Promise<void> {
		if (this.events.some((item) => item.eventId === event.eventId)) {
			throw new Error('E11000 eventId');
		}
		this.events.push({ ...event });
	}

	async findPending(limit: number): Promise<StoredAuditEvent[]> {
		return this.events
			.filter((event) => event.seq === null)
			.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
			.slice(0, limit)
			.map((event) => ({ ...event }));
	}

	async seal(
		eventId: string,
		seal: { seq: number; prevHash: string; hash: string; sealedAt: Date }
	): Promise<boolean> {
		const event = this.events.find(
			(item) => item.eventId === eventId && item.seq === null
		);
		if (!event) return false;
		if (this.events.some((item) => item.seq === seal.seq)) {
			throw new Error('E11000 seq');
		}
		Object.assign(event, seal);
		return true;
	}

	async findSealedAfter(
		afterSeq: number,
		limit: number
	): Promise<SealedAuditEvent[]> {
		return this.events
			.filter(isSealed)
			.filter((event) => event.seq > afterSeq)
			.sort((a, b) => a.seq - b.seq)
			.slice(0, limit)
			.map((event) => ({ ...event }));
	}

	async findSealedBySeq(seq: number): Promise<SealedAuditEvent | null> {
		const event = this.events.filter(isSealed).find((item) => item.seq === seq);
		return event ? { ...event } : null;
	}

	async findLastSealed(): Promise<SealedAuditEvent | null> {
		const sealed = this.events.filter(isSealed).sort((a, b) => b.seq - a.seq);
		return sealed[0] ? { ...sealed[0] } : null;
	}

	async countPending(): Promise<number> {
		return this.events.filter((event) => event.seq === null).length;
	}

	async list(
		query: AuditEventListQuery,
		limit: number
	): Promise<StoredAuditEvent[]> {
		const before = query.before;
		return this.events
			.filter((event) => !query.type || event.type === query.type)
			.filter((event) => !query.subject || event.subject === query.subject)
			.filter((event) => {
				if (!before) return true;
				const at = event.createdAt.getTime();
				const limitAt = before.createdAt.getTime();
				return (
					at < limitAt || (at === limitAt && event.eventId < before.eventId)
				);
			})
			.sort(
				(a, b) =>
					b.createdAt.getTime() - a.createdAt.getTime() ||
					(a.eventId < b.eventId ? 1 : -1)
			)
			.slice(0, limit)
			.map((event) => ({ ...event }));
	}

	async tryAcquireLease(
		owner: string,
		now: Date,
		leaseMs: number
	): Promise<AuditChainHead | null> {
		const held =
			this.head.leaseUntil !== null &&
			this.head.leaseUntil.getTime() >= now.getTime();
		if (held) return null;
		this.head.leaseOwner = owner;
		this.head.leaseUntil = new Date(now.getTime() + leaseMs);
		return { seq: this.head.seq, hash: this.head.hash };
	}

	async advanceHead(owner: string, head: AuditChainHead): Promise<void> {
		if (this.failAdvanceOnce) {
			this.failAdvanceOnce = false;
			throw new Error('instância caiu');
		}
		if (this.head.leaseOwner !== owner) return;
		this.head.seq = head.seq;
		this.head.hash = head.hash;
	}

	async releaseLease(owner: string): Promise<void> {
		if (this.head.leaseOwner !== owner) return;
		this.head.leaseOwner = null;
		this.head.leaseUntil = null;
	}

	async findHead(): Promise<AuditChainHead | null> {
		return { seq: this.head.seq, hash: this.head.hash };
	}
}
