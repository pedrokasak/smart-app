import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import {
	RiWatchCounts,
	RiWatchFailureView,
	RiWatchMetricsReader,
	RiWatchMetricsSnapshot,
} from 'src/ri-intelligence/watch/application/ports/ri-watch-metrics.port';
import {
	RI_WATCH_FINISHED_STATUSES,
	RI_WATCH_MAX_ATTEMPTS,
} from 'src/ri-intelligence/watch/domain/ri-watch';
import { RiWatchDocumentSchema } from './ri-watch-document.model';

type Filter = FilterQuery<RiWatchDocumentSchema>;

const FAILURE_REASONS_LIMIT = 8;
const RECENT_FAILURES_LIMIT = 10;
const FAILED_STATUSES = ['skipped', 'failed'];

/**
 * Metricas do vigia de RI para o painel admin (TRA-267), direto da colecao
 * do vigia. So documento publico da CVM e da B3: nenhum dado de usuario —
 * quem foi avisado fica nas notificacoes, e daqui sai so a contagem.
 */
@Injectable()
export class MongoRiWatchMetricsReader implements RiWatchMetricsReader {
	constructor(
		@InjectModel('RiWatchDocument')
		private readonly model: Model<RiWatchDocumentSchema>
	) {}

	async read(since: Date): Promise<RiWatchMetricsSnapshot> {
		const finished = { status: { $in: RI_WATCH_FINISHED_STATUSES } };
		const [
			pending,
			awaitingNotification,
			awaitingIndex,
			totals,
			window,
			failureReasons,
			recentFailures,
			usage,
		] = await Promise.all([
			this.count({
				status: 'pending',
				attempts: { $lt: RI_WATCH_MAX_ATTEMPTS },
			}),
			this.count({ ...finished, notifiedAt: null }),
			this.count({ ...finished, indexedAt: null }),
			this.counts({}),
			this.counts({ since }),
			this.failureReasons(since),
			this.recentFailures(),
			this.usage(since),
		]);
		return {
			queue: { pending, awaitingNotification, awaitingIndex },
			totals,
			window,
			failureReasons,
			recentFailures,
			usage,
		};
	}

	private count(filter: Filter): Promise<number> {
		return this.model.countDocuments(filter).exec();
	}

	/** Sem `since`: desde sempre. Com: o que aconteceu desde entao. */
	private async counts({ since }: { since?: Date }): Promise<RiWatchCounts> {
		const after = since ? { $gte: since } : undefined;
		const processed = (status: string): Filter =>
			after ? { status, processedAt: after } : { status };
		const [discovered, summarized, skipped, failed, notified, indexed] =
			await Promise.all([
				this.count(after ? { discoveredAt: after } : {}),
				this.count(processed('summarized')),
				this.count(processed('skipped')),
				this.count(processed('failed')),
				this.count({ notifiedAt: after ?? { $ne: null } }),
				this.count({ indexedAt: after ?? { $ne: null } }),
			]);
		return { discovered, summarized, skipped, failed, notified, indexed };
	}

	private async failureReasons(
		since: Date
	): Promise<{ reason: string; count: number }[]> {
		const rows = await this.model
			.aggregate<{ _id: string | null; count: number }>([
				{
					$match: {
						status: { $in: FAILED_STATUSES },
						processedAt: { $gte: since },
					},
				},
				{ $group: { _id: '$lastError', count: { $sum: 1 } } },
				{ $sort: { count: -1, _id: 1 } },
				{ $limit: FAILURE_REASONS_LIMIT },
			])
			.exec();
		return rows.map((row) => ({
			reason: row._id || 'unknown',
			count: row.count,
		}));
	}

	private async recentFailures(): Promise<RiWatchFailureView[]> {
		const docs = await this.model
			.find({ status: { $in: FAILED_STATUSES } })
			.sort({ processedAt: -1 })
			.limit(RECENT_FAILURES_LIMIT)
			.select(
				'ticker documentType record.title publishedAt status lastError attempts processedAt'
			)
			.lean<RiWatchDocumentSchema[]>();
		return docs.map((doc) => ({
			ticker: doc.ticker,
			documentType: doc.documentType,
			title: doc.record?.title ?? '',
			publishedAt: new Date(doc.publishedAt).toISOString(),
			status: doc.status as RiWatchFailureView['status'],
			reason: doc.lastError ?? null,
			attempts: doc.attempts ?? 0,
			processedAt: doc.processedAt
				? new Date(doc.processedAt).toISOString()
				: null,
		}));
	}

	private async usage(
		since: Date
	): Promise<{ aiCalls: number; tokens: number }> {
		const [row] = await this.model
			.aggregate<{ aiCalls: number; tokens: number }>([
				{ $match: { status: 'summarized', processedAt: { $gte: since } } },
				{
					$group: {
						_id: null,
						aiCalls: { $sum: { $ifNull: ['$summary.cost.aiCalls', 0] } },
						tokens: { $sum: { $ifNull: ['$summary.cost.tokens', 0] } },
					},
				},
			])
			.exec();
		return { aiCalls: row?.aiCalls ?? 0, tokens: row?.tokens ?? 0 };
	}
}
