import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import { RiWatchStore } from 'src/ri-intelligence/watch/application/ports/ri-watch-store.port';
import {
	RI_WATCH_MAX_ATTEMPTS,
	RiWatchDocument,
	RiWatchSummarySnapshot,
	watchDocumentKey,
} from 'src/ri-intelligence/watch/domain/ri-watch';
import { RiWatchDocumentSchema } from './ri-watch-document.model';

/**
 * Adaptador Mongo da porta do vigia de RI (TRA-240). Unico arquivo do vigia
 * que conhece Mongoose.
 */
@Injectable()
export class MongoRiWatchRepository implements RiWatchStore {
	constructor(
		@InjectModel('RiWatchDocument')
		private readonly model: Model<RiWatchDocumentSchema>
	) {}

	async registerNew(records: RiDocumentRecord[], now: Date): Promise<number> {
		const byKey = new Map<string, RiDocumentRecord>();
		for (const record of records) {
			const key = watchDocumentKey(record);
			if (key && !byKey.has(key)) byKey.set(key, record);
		}
		if (!byKey.size) return 0;

		// So $setOnInsert: um documento ja registrado nao volta para a fila, e
		// o indice unico em `key` fecha a corrida entre duas varreduras.
		const result = await this.model.bulkWrite(
			[...byKey.entries()].map(([key, record]) => ({
				updateOne: {
					filter: { key },
					update: {
						$setOnInsert: {
							key,
							ticker: record.ticker,
							documentType: record.documentType,
							publishedAt: new Date(record.publishedAt),
							record,
							status: 'pending' as const,
							attempts: 0,
							discoveredAt: now,
							processedAt: null,
							lastError: null,
							summary: null,
						},
					},
					upsert: true,
				},
			})),
			{ ordered: false }
		);
		return result.upsertedCount ?? 0;
	}

	async findPending(limit: number): Promise<RiWatchDocument[]> {
		const docs = await this.model
			.find({ status: 'pending', attempts: { $lt: RI_WATCH_MAX_ATTEMPTS } })
			.sort({ publishedAt: -1 })
			.limit(limit)
			.lean<RiWatchDocumentSchema[]>();
		return docs.map((doc) => this.toDomain(doc));
	}

	async markSummarized(
		key: string,
		summary: RiWatchSummarySnapshot,
		now: Date
	): Promise<void> {
		await this.model.updateOne(
			{ key },
			{
				$set: {
					status: 'summarized',
					summary,
					processedAt: now,
					lastError: null,
				},
			}
		);
	}

	async markSkipped(key: string, reason: string, now: Date): Promise<void> {
		await this.model.updateOne(
			{ key },
			{ $set: { status: 'skipped', lastError: reason, processedAt: now } }
		);
	}

	async recordFailure(key: string, reason: string, now: Date): Promise<void> {
		await this.model.updateOne(
			{ key },
			{ $inc: { attempts: 1 }, $set: { lastError: reason, processedAt: now } }
		);
		// No teto sai da fila de vez; o motivo da ultima falha fica registrado.
		await this.model.updateOne(
			{ key, status: 'pending', attempts: { $gte: RI_WATCH_MAX_ATTEMPTS } },
			{ $set: { status: 'failed' } }
		);
	}

	private toDomain(doc: RiWatchDocumentSchema): RiWatchDocument {
		return {
			key: doc.key,
			ticker: doc.ticker,
			documentType: doc.documentType,
			publishedAt: new Date(doc.publishedAt).toISOString(),
			record: doc.record,
			status: doc.status,
			attempts: Number(doc.attempts ?? 0),
			discoveredAt: new Date(doc.discoveredAt).toISOString(),
			processedAt: doc.processedAt
				? new Date(doc.processedAt).toISOString()
				: null,
			lastError: doc.lastError ?? null,
			summary: doc.summary ?? null,
		};
	}
}
