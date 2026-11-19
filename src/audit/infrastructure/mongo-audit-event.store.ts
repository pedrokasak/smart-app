import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
	AuditChainHead,
	AuditEventListQuery,
	AuditEventStore,
} from 'src/audit/application/ports/audit-event-store.port';
import {
	GENESIS_HASH,
	SealedAuditEvent,
	StoredAuditEvent,
} from 'src/audit/domain/audit-event';
import { AuditChainDoc } from './audit.models';

const HEAD_ID = 'head';
const NO_ID = { _id: 0 };

/** Único arquivo da trilha que conhece Mongoose. */
@Injectable()
export class MongoAuditEventStore implements AuditEventStore {
	constructor(
		@InjectModel('AuditEvent') private readonly events: Model<StoredAuditEvent>,
		@InjectModel('AuditChain') private readonly chain: Model<AuditChainDoc>
	) {}

	async insertPending(event: StoredAuditEvent): Promise<void> {
		await this.events.create(event);
	}

	async findPending(limit: number): Promise<StoredAuditEvent[]> {
		return this.events
			.find({ seq: null }, NO_ID)
			.sort({ createdAt: 1, _id: 1 })
			.limit(limit)
			.lean<StoredAuditEvent[]>()
			.exec();
	}

	async seal(
		eventId: string,
		seal: { seq: number; prevHash: string; hash: string; sealedAt: Date }
	): Promise<boolean> {
		const result = await this.events
			.updateOne({ eventId, seq: null }, { $set: seal })
			.exec();
		return result.modifiedCount === 1;
	}

	async findSealedAfter(
		afterSeq: number,
		limit: number
	): Promise<SealedAuditEvent[]> {
		return this.events
			.find({ seq: { $gt: afterSeq } }, NO_ID)
			.sort({ seq: 1 })
			.limit(limit)
			.lean<SealedAuditEvent[]>()
			.exec();
	}

	async findSealedBySeq(seq: number): Promise<SealedAuditEvent | null> {
		return this.events.findOne({ seq }, NO_ID).lean<SealedAuditEvent>().exec();
	}

	async findLastSealed(): Promise<SealedAuditEvent | null> {
		return this.events
			.findOne({ seq: { $type: 'number' } }, NO_ID)
			.sort({ seq: -1 })
			.lean<SealedAuditEvent>()
			.exec();
	}

	async countPending(): Promise<number> {
		return this.events.countDocuments({ seq: null }).exec();
	}

	async list(
		query: AuditEventListQuery,
		limit: number
	): Promise<StoredAuditEvent[]> {
		const filter: Record<string, unknown> = {};
		if (query.type) filter.type = query.type;
		if (query.subject) filter.subject = query.subject;
		if (query.before) {
			filter.$or = [
				{ createdAt: { $lt: query.before.createdAt } },
				{
					createdAt: query.before.createdAt,
					eventId: { $lt: query.before.eventId },
				},
			];
		}
		return this.events
			.find(filter, NO_ID)
			.sort({ createdAt: -1, eventId: -1 })
			.limit(limit)
			.lean<StoredAuditEvent[]>()
			.exec();
	}

	async tryAcquireLease(
		owner: string,
		now: Date,
		leaseMs: number
	): Promise<AuditChainHead | null> {
		try {
			// Upsert com filtro de "concessão livre ou vencida": se o documento
			// existe com concessão viva, o filtro não casa, o upsert tenta criar
			// o mesmo `_id` e o Mongo devolve E11000 — que aqui significa "ocupado".
			const doc = await this.chain
				.findOneAndUpdate(
					{
						_id: HEAD_ID,
						$or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }],
					},
					{
						$set: {
							leaseOwner: owner,
							leaseUntil: new Date(now.getTime() + leaseMs),
						},
						$setOnInsert: { seq: 0, hash: GENESIS_HASH },
					},
					{ upsert: true, new: true }
				)
				.lean<AuditChainDoc>()
				.exec();
			return doc ? { seq: doc.seq, hash: doc.hash } : null;
		} catch (err) {
			if ((err as { code?: number })?.code === 11000) return null;
			throw err;
		}
	}

	async advanceHead(owner: string, head: AuditChainHead): Promise<void> {
		await this.chain
			.updateOne(
				{ _id: HEAD_ID, leaseOwner: owner },
				{ $set: { seq: head.seq, hash: head.hash } }
			)
			.exec();
	}

	async releaseLease(owner: string): Promise<void> {
		await this.chain
			.updateOne(
				{ _id: HEAD_ID, leaseOwner: owner },
				{ $set: { leaseOwner: null, leaseUntil: null } }
			)
			.exec();
	}

	async findHead(): Promise<AuditChainHead | null> {
		const doc = await this.chain
			.findOne({ _id: HEAD_ID })
			.lean<AuditChainDoc>()
			.exec();
		return doc ? { seq: doc.seq, hash: doc.hash } : null;
	}
}
