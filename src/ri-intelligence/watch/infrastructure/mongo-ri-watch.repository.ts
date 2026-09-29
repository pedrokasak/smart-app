import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import { RiWatchStore } from 'src/ri-intelligence/watch/application/ports/ri-watch-store.port';
import {
	RI_WATCH_FINISHED_STATUSES,
	RI_WATCH_MAX_ATTEMPTS,
	RiWatchDocument,
	RiWatchNotificationSnapshot,
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
							notifiedAt: null,
							notification: null,
							indexedAt: null,
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

	async findUnnotified(
		limit: number,
		pendingSince: Date
	): Promise<RiWatchDocument[]> {
		// `notifiedAt: null` casa tambem o campo ausente: documento registrado
		// antes da TRA-261 entra na fila de aviso (e o corte por idade o
		// descarta se for velho).
		const docs = await this.model
			.find({
				notifiedAt: null,
				$or: [
					{ status: { $in: [...RI_WATCH_FINISHED_STATUSES] } },
					{ status: 'pending', discoveredAt: { $lte: pendingSince } },
				],
			})
			.sort({ publishedAt: -1 })
			.limit(limit)
			.lean<RiWatchDocumentSchema[]>();
		return docs.map((doc) => this.toDomain(doc));
	}

	async markNotified(
		key: string,
		notification: RiWatchNotificationSnapshot,
		now: Date
	): Promise<void> {
		await this.model.updateOne(
			{ key },
			{ $set: { notifiedAt: now, notification } }
		);
	}

	async findUnindexed(limit: number): Promise<RiWatchDocument[]> {
		// `indexedAt: null` casa o campo ausente: o que o vigia processou
		// antes do acervo existir entra na fila e o preenche aos poucos.
		const docs = await this.model
			.find({
				status: { $in: [...RI_WATCH_FINISHED_STATUSES] },
				indexedAt: null,
			})
			.sort({ publishedAt: -1 })
			.limit(limit)
			.lean<RiWatchDocumentSchema[]>();
		return docs.map((doc) => this.toDomain(doc));
	}

	async markIndexed(key: string, now: Date): Promise<void> {
		await this.model.updateOne({ key }, { $set: { indexedAt: now } });
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
			notifiedAt: doc.notifiedAt
				? new Date(doc.notifiedAt).toISOString()
				: null,
			notification: doc.notification ?? null,
			indexedAt: doc.indexedAt ? new Date(doc.indexedAt).toISOString() : null,
		};
	}
}
