import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, PipelineStage } from 'mongoose';
import {
	sortDeadlines,
	ALERT_DEADLINES_MAX,
} from '../application/alert-deadline';
import {
	NO_DUE_SENTINEL,
	clampAlertPageSize,
	decodeAlertCursor,
	encodeAlertCursor,
	alertCursorOf,
} from '../application/alert-cursor';
import {
	ALERT_IDS_BY_FILTER_MAX,
	AlertFilter,
	AlertListQuery,
	AlertPage,
	AlertStorePort,
	NewAlert,
	OpenAlertCounts,
} from '../application/ports/alert.store.port';
import { alertPriorityRank } from '../domain/alert-priority';
import { Alert } from '../domain/attention.entities';
import {
	AlertPriority,
	AlertRule,
	AlertStatus,
	SnapshotSource,
} from '../domain/enums';
import {
	ADVISOR_ALERT_MODEL,
	ALERT_ACTIVE_CONDITION_INDEX,
	AdvisorAlertDoc,
} from './advisor-attention.models';
import { toAlert } from './advisor.mappers';
import { isDuplicateOnIndex } from './mongo-duplicate-key';

const ACTIVE_STATUSES = [AlertStatus.Open, AlertStatus.Snoozed];
const isActiveStatus = (status: AlertStatus): boolean =>
	ACTIVE_STATUSES.includes(status);

/** Campos que o `patch` nunca altera. */
const IMMUTABLE_KEYS = new Set([
	'id',
	'orgId',
	'clientProfileId',
	'conditionKey',
	'portfolioId',
	'createdAt',
	'updatedAt',
]);

type AlertQuery = FilterQuery<AdvisorAlertDoc>;

@Injectable()
export class MongoAlertStore implements AlertStorePort {
	constructor(
		@InjectModel(ADVISOR_ALERT_MODEL)
		private readonly alerts: Model<AdvisorAlertDoc>
	) {}

	/**
	 * Um por vez: o índice único parcial rejeita o duplicado ativo (E11000 no
	 * índice certo) e só ele é ignorado; qualquer outro erro sobe.
	 */
	async insertMany(alerts: NewAlert[]): Promise<Alert[]> {
		const stored: Alert[] = [];
		for (const { id, ...alert } of alerts) {
			try {
				const created = await this.alerts.create({
					...alert,
					...(id !== undefined && { _id: id }),
					priorityRank: alertPriorityRank(alert.priority),
					active: isActiveStatus(alert.status),
				});
				stored.push(toAlert(created.toObject()));
			} catch (error) {
				if (
					!isDuplicateOnIndex(error, ALERT_ACTIVE_CONDITION_INDEX, [
						'orgId',
						'clientProfileId',
						'conditionKey',
					])
				) {
					throw error;
				}
			}
		}
		return stored;
	}

	async listForClient(
		orgId: string,
		clientProfileId: string,
		since: Date
	): Promise<Alert[]> {
		const docs = await this.alerts
			.find({
				orgId,
				clientProfileId,
				$or: [{ active: true }, { updatedAt: { $gte: since } }],
			})
			.sort({ createdAt: 1, _id: 1 })
			.lean<AdvisorAlertDoc[]>()
			.exec();
		return docs.map(toAlert);
	}

	/**
	 * Um `findOneAndUpdate` com o status esperado no filtro. Chave com valor
	 * `undefined` vira `$unset`; `priority` e `status` levam `priorityRank` e
	 * `active` junto.
	 */
	async patch(
		id: string,
		patch: Partial<Alert>,
		expectedStatus?: AlertStatus[]
	): Promise<Alert | null> {
		const set: Record<string, unknown> = {};
		const unset: Record<string, ''> = {};
		for (const [key, value] of Object.entries(patch)) {
			if (IMMUTABLE_KEYS.has(key)) continue;
			if (value === undefined) unset[key] = '';
			else set[key] = value;
		}
		if (patch.priority !== undefined) {
			set.priorityRank = alertPriorityRank(patch.priority);
		}
		if (patch.status !== undefined) set.active = isActiveStatus(patch.status);
		const update = {
			...(Object.keys(set).length > 0 && { $set: set }),
			...(Object.keys(unset).length > 0 && { $unset: unset }),
		};
		const doc = await this.alerts
			.findOneAndUpdate(
				{ _id: id, ...(expectedStatus && { status: { $in: expectedStatus } }) },
				update,
				{ new: true, runValidators: true }
			)
			.lean<AdvisorAlertDoc>()
			.exec();
		return doc ? toAlert(doc) : null;
	}

	async resolveMany(ids: string[], at: Date): Promise<number> {
		if (ids.length === 0) return 0;
		const result = await this.alerts
			.updateMany(
				{ _id: { $in: ids }, status: { $in: ACTIVE_STATUSES } },
				{ $set: { status: AlertStatus.Resolved, active: false, closedAt: at } }
			)
			.exec();
		return result.modifiedCount;
	}

	async findById(orgId: string, id: string): Promise<Alert | null> {
		const doc = await this.alerts
			.findOne({ _id: id, orgId })
			.lean<AdvisorAlertDoc>()
			.exec();
		return doc ? toAlert(doc) : null;
	}

	/**
	 * `$addFields` leva o prazo ao sentinela (sem prazo por último) antes do
	 * `$sort`; o cursor repete a tupla do último item como `$or` de desempates.
	 */
	async list(orgId: string, q: AlertListQuery): Promise<AlertPage> {
		const limit = clampAlertPageSize(q.limit);
		const after = q.cursor ? decodeAlertCursor(q.cursor) : null;
		const match = this.matchOf(orgId, q);
		if (!match) return { items: [], nextCursor: null };
		const docs = await this.alerts
			.aggregate<AdvisorAlertDoc>(
				this.queuePipeline(match, limit + 1, after ? this.after(after) : null)
			)
			.exec();
		const items = docs.slice(0, limit).map(toAlert);
		const last = items[items.length - 1];
		return {
			items,
			nextCursor:
				docs.length > limit && last
					? encodeAlertCursor(alertCursorOf(last))
					: null,
		};
	}

	async countOpenByPriority(
		orgId: string,
		clientIds?: string[]
	): Promise<OpenAlertCounts> {
		const counts: OpenAlertCounts = {
			[AlertPriority.P0]: 0,
			[AlertPriority.P1]: 0,
			[AlertPriority.P2]: 0,
			[AlertPriority.P3]: 0,
		};
		const match = this.matchOf(orgId, {
			statuses: [AlertStatus.Open],
			clientIds,
		});
		if (!match) return counts;
		const rows = await this.alerts
			.aggregate<{
				_id: AlertPriority;
				count: number;
			}>([
				{ $match: match },
				{ $group: { _id: '$priority', count: { $sum: 1 } } },
			])
			.exec();
		for (const row of rows) counts[row._id] = row.count;
		return counts;
	}

	/**
	 * Duas consultas (dueDate dos MANUAL ativos; snoozedUntil dos adiados),
	 * cada uma já do prazo mais próximo; a junção ordena e corta em 500.
	 */
	async listDeadlines(
		orgId: string,
		from: string,
		to: string,
		clientIds?: string[]
	): Promise<Alert[]> {
		if (clientIds?.length === 0) return [];
		const scope: AlertQuery = {
			orgId,
			...(clientIds && { clientProfileId: { $in: clientIds } }),
		};
		const window = { $gte: from, $lte: to };
		const [manual, snoozed] = await Promise.all([
			this.alerts
				.find({
					...scope,
					rule: AlertRule.Manual,
					active: true,
					dueDate: window,
				})
				.sort({ dueDate: 1, _id: 1 })
				.limit(ALERT_DEADLINES_MAX)
				.lean<AdvisorAlertDoc[]>()
				.exec(),
			this.alerts
				.find({
					...scope,
					status: AlertStatus.Snoozed,
					snoozedUntil: window,
				})
				.sort({ snoozedUntil: 1, _id: 1 })
				.limit(ALERT_DEADLINES_MAX)
				.lean<AdvisorAlertDoc[]>()
				.exec(),
		]);
		const byId = new Map<string, Alert>();
		for (const doc of [...manual, ...snoozed]) byId.set(doc._id, toAlert(doc));
		return sortDeadlines([...byId.values()], from, to);
	}

	async idsByFilter(
		orgId: string,
		q: AlertFilter,
		max: number
	): Promise<string[]> {
		const cap = Math.min(
			Math.max(Math.trunc(max) || 0, 0),
			ALERT_IDS_BY_FILTER_MAX
		);
		const match = this.matchOf(orgId, q);
		if (!match || cap === 0) return [];
		const docs = await this.alerts
			.aggregate<{
				_id: string;
			}>([...this.queuePipeline(match, cap, null), { $project: { _id: 1 } }])
			.exec();
		return docs.map((d) => d._id);
	}

	async deleteByClient(orgId: string, clientProfileId: string): Promise<void> {
		await this.alerts.deleteMany({ orgId, clientProfileId }).exec();
	}

	async deleteSharedExcept(
		orgId: string,
		clientProfileId: string,
		portfolioIds: string[]
	): Promise<number> {
		const result = await this.alerts
			.deleteMany({
				orgId,
				clientProfileId,
				source: SnapshotSource.B2cShared,
				portfolioId: { $nin: portfolioIds },
			})
			.exec();
		return result.deletedCount;
	}

	/** `null` quando o filtro de clientes é uma lista vazia (nada casa). */
	private matchOf(orgId: string, q: AlertFilter): AlertQuery | null {
		if (q.clientIds?.length === 0) return null;
		return {
			orgId,
			status: { $in: q.statuses },
			...(q.clientIds && { clientProfileId: { $in: q.clientIds } }),
			...(q.priorities && { priority: { $in: q.priorities } }),
			...(q.rules && { rule: { $in: q.rules } }),
		};
	}

	private after(c: ReturnType<typeof decodeAlertCursor>): AlertQuery {
		return {
			$or: [
				{ priorityRank: { $gt: c.rank } },
				{ priorityRank: c.rank, _due: { $gt: c.due } },
				{ priorityRank: c.rank, _due: c.due, createdAt: { $lt: c.createdAt } },
				{
					priorityRank: c.rank,
					_due: c.due,
					createdAt: c.createdAt,
					_id: { $gt: c.id },
				},
			],
		};
	}

	private queuePipeline(
		match: AlertQuery,
		limit: number,
		after: AlertQuery | null
	): PipelineStage[] {
		return [
			{ $match: match },
			{ $addFields: { _due: { $ifNull: ['$dueDate', NO_DUE_SENTINEL] } } },
			...(after ? [{ $match: after } as PipelineStage] : []),
			{ $sort: { priorityRank: 1, _due: 1, createdAt: -1, _id: 1 } },
			{ $limit: limit },
			{ $project: { _due: 0 } },
		];
	}
}
