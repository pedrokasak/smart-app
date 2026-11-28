import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import type { AuditTrail } from 'src/audit/application/audit-trail.port';
import { Alert } from '../../domain/attention.entities';
import { addIsoDays, businessDate } from '../../domain/business-date';
import { AlertRule, AlertStatus } from '../../domain/enums';
import { deadlineInWindow } from '../alert-deadline';
import {
	ADVISOR_ALERT_STORE,
	ADVISOR_CLIENT_SNAPSHOT_STORE,
	ADVISOR_WEALTH_DAILY_STORE,
} from '../advisor.tokens';
import type { AccessContext } from '../authorization.service';
import type {
	AlertStorePort,
	OpenAlertCounts,
} from '../ports/alert.store.port';
import type { ClientSnapshotStorePort } from '../ports/client-snapshot.store.port';
import type {
	WealthDailyStorePort,
	WealthDailySum,
} from '../ports/wealth-daily.store.port';
import { AlertService } from './alert.service';
import { alertsViewedEvent } from './alerts-viewed-event';
import { InvalidAlertInputError } from './attention-errors';

export const DASHBOARD_DEFAULT_DAYS = 90;
export const DASHBOARD_MIN_DAYS = 7;
export const DASHBOARD_MAX_DAYS = 365;
/** Variação do painel: 30 dias. */
export const DASHBOARD_CHANGE_DAYS = 30;
/** Próximos prazos: 14 dias. */
export const DASHBOARD_DEADLINE_DAYS = 14;
export const DASHBOARD_TOP_ALERTS = 5;
/** TTL da série diária: nada mais antigo existe. */
const SERIES_TTL_DAYS = 400;

export interface DashboardWealth {
	totalMinor: number | null;
	verifiedMinor: number | null;
	manualMinor: number | null;
	/** O `asOf` mais antigo entre os snapshots somados. */
	asOf: string | null;
}

export interface DashboardChange {
	deltaMinor: number;
	pct: number | null;
	clientsJoined: number;
	clientsLeft: number;
}

export interface DashboardDeadline {
	alertId: string;
	clientProfileId: string;
	kind: 'DUE' | 'SNOOZE_END';
	date: string;
}

export interface Dashboard {
	wealth: DashboardWealth;
	change30d: DashboardChange | null;
	clients: number;
	openAlerts: OpenAlertCounts;
	topAlerts: Alert[];
	deadlines: DashboardDeadline[];
	series: Array<{ date: string; totalMinor: number }>;
}

const addDays = addIsoDays;

/** O último dia da série (crescente) em `date` ou antes dele. */
const latestOnOrBefore = (
	series: WealthDailySum[],
	date: string
): WealthDailySum | null => {
	for (let i = series.length - 1; i >= 0; i -= 1) {
		if (series[i].date <= date) return series[i];
	}
	return null;
};

/**
 * Painel do assessor, só do read model: snapshots, série diária e alertas.
 * Nunca recalcula uma carteira. O alcance vem de `AlertService.scopeClientIds`
 * (ADVISOR: os atribuídos; ORG_ADMIN: a organização toda). Grava um
 * `advisor.alerts.viewed` por leitura, antes de devolver (falha fechada).
 */
@Injectable()
export class DashboardService {
	constructor(
		private readonly alertService: AlertService,
		@Inject(ADVISOR_CLIENT_SNAPSHOT_STORE)
		private readonly snapshots: ClientSnapshotStorePort,
		@Inject(ADVISOR_WEALTH_DAILY_STORE)
		private readonly wealth: WealthDailyStorePort,
		@Inject(ADVISOR_ALERT_STORE) private readonly alerts: AlertStorePort,
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail
	) {}

	async get(
		ctx: AccessContext,
		days: number = DASHBOARD_DEFAULT_DAYS
	): Promise<Dashboard> {
		if (
			!Number.isInteger(days) ||
			days < DASHBOARD_MIN_DAYS ||
			days > DASHBOARD_MAX_DAYS
		) {
			throw new InvalidAlertInputError('days');
		}
		const clientIds = await this.alertService.scopeClientIds(ctx);
		const today = businessDate(new Date());

		const [snapshots, series, openAlerts, top, due] = await Promise.all([
			this.snapshots.listByOrg(ctx.orgId, clientIds),
			this.wealth.sumByDate(ctx.orgId, addDays(today, -days), today, clientIds),
			this.alerts.countOpenByPriority(ctx.orgId, clientIds),
			this.alerts.list(ctx.orgId, {
				clientIds,
				statuses: [AlertStatus.Open],
				limit: DASHBOARD_TOP_ALERTS,
			}),
			this.alerts.listDeadlines(
				ctx.orgId,
				today,
				addDays(today, DASHBOARD_DEADLINE_DAYS),
				clientIds
			),
		]);

		const topAlerts = top.items.slice(0, DASHBOARD_TOP_ALERTS);
		const deadlines = this.deadlinesOf(due, today);
		const change30d = await this.changeOf(ctx.orgId, series, today, clientIds);
		// Depois de toda leitura que a resposta usa; falha fechada.
		await this.audit.record(
			alertsViewedEvent(ctx, [
				...topAlerts.map((a) => a.clientProfileId),
				...deadlines.map((d) => d.clientProfileId),
			])
		);

		return {
			wealth: this.wealthOf(snapshots),
			change30d,
			clients: snapshots.length,
			openAlerts,
			topAlerts,
			deadlines,
			series: series.map((s) => ({ date: s.date, totalMinor: s.totalMinor })),
		};
	}

	private wealthOf(
		snapshots: Array<{
			totalMinor: number;
			verifiedMinor: number;
			manualMinor: number;
			asOf: string;
		}>
	): DashboardWealth {
		if (snapshots.length === 0) {
			return {
				totalMinor: null,
				verifiedMinor: null,
				manualMinor: null,
				asOf: null,
			};
		}
		return {
			totalMinor: snapshots.reduce((s, x) => s + x.totalMinor, 0),
			verifiedMinor: snapshots.reduce((s, x) => s + x.verifiedMinor, 0),
			manualMinor: snapshots.reduce((s, x) => s + x.manualMinor, 0),
			asOf: snapshots.reduce(
				(oldest, x) => (x.asOf < oldest ? x.asOf : oldest),
				snapshots[0].asOf
			),
		};
	}

	/**
	 * Série em `today` (ou o último dia antes) contra `today − 30` (ou o
	 * último dia antes). `null` sem linha nessa data. A linha-base pode ser
	 * mais velha que a janela pedida, então cai numa leitura própria.
	 */
	private async changeOf(
		orgId: string,
		series: WealthDailySum[],
		today: string,
		clientIds: string[] | undefined
	): Promise<DashboardChange | null> {
		const baseDate = addDays(today, -DASHBOARD_CHANGE_DAYS);
		const later = latestOnOrBefore(series, today);
		// Série velha (nada nos últimos 30 dias): sem o que comparar.
		if (!later || later.date <= baseDate) return null;
		let earlier = latestOnOrBefore(series, baseDate);
		if (!earlier) {
			const older = await this.wealth.sumByDate(
				orgId,
				addDays(today, -SERIES_TTL_DAYS),
				baseDate,
				clientIds
			);
			earlier = latestOnOrBefore(older, baseDate);
		}
		if (!earlier) return null;

		const [nowIds, thenIds] = await Promise.all([
			this.wealth.clientIdsOn(orgId, later.date, clientIds),
			this.wealth.clientIdsOn(orgId, earlier.date, clientIds),
		]);
		const now = new Set(nowIds);
		const then = new Set(thenIds);
		const deltaMinor = later.totalMinor - earlier.totalMinor;
		return {
			deltaMinor,
			pct: earlier.totalMinor === 0 ? null : deltaMinor / earlier.totalMinor,
			clientsJoined: nowIds.filter((id) => !then.has(id)).length,
			clientsLeft: thenIds.filter((id) => !now.has(id)).length,
		};
	}

	private deadlinesOf(due: Alert[], today: string): DashboardDeadline[] {
		const to = addDays(today, DASHBOARD_DEADLINE_DAYS);
		return due.flatMap((alert) => {
			const date = deadlineInWindow(alert, today, to);
			if (date === null) return [];
			const kind =
				alert.rule === AlertRule.Manual && alert.dueDate === date
					? 'DUE'
					: 'SNOOZE_END';
			return [
				{
					alertId: alert.id,
					clientProfileId: alert.clientProfileId,
					kind,
					date,
				},
			];
		});
	}
}
