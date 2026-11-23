import { Inject, Injectable } from '@nestjs/common';
import { reconcileAlerts } from '../../domain/alert-reconcile';
import { evaluateAlerts } from '../../domain/alert-rules';
import { DEFAULT_ALERT_SETTINGS } from '../../domain/alert-settings';
import {
	Alert,
	AlertCandidate,
	ClientSnapshot,
	conditionKeyOf,
	SellWindow,
	SourceSnapshot,
} from '../../domain/attention.entities';
import {
	AlertRule,
	AlertStatus,
	Provenance,
	RelationshipStatus,
	SnapshotSource,
	TransactionSide,
} from '../../domain/enums';
import {
	ADVISOR_ALERT_SETTINGS_STORE,
	ADVISOR_ALERT_STORE,
	ADVISOR_CLIENT_CONTACT_STORE,
	ADVISOR_CLIENT_SNAPSHOT_STORE,
	ADVISOR_RELATIONSHIP_STORE,
	ADVISOR_TRANSACTION_STORE,
	ADVISOR_WEALTH_DAILY_STORE,
} from '../advisor.tokens';
import type { ClientPortfolioMetrics } from '../metrics/build-portfolio-metrics';
import { PortfolioMetricsService } from '../metrics/portfolio-metrics.service';
import type { AlertSettingsStorePort } from '../ports/alert-settings.store.port';
import type { AlertStorePort, NewAlert } from '../ports/alert.store.port';
import type { ClientAttentionPurgePort } from '../ports/client-attention-purge.port';
import type { ClientContactStorePort } from '../ports/client-contact.store.port';
import type { ClientSnapshotStorePort } from '../ports/client-snapshot.store.port';
import type { RelationshipStorePort } from '../ports/relationship.store.port';
import type { TransactionStorePort } from '../ports/transaction.store.port';
import type {
	WealthDailyRow,
	WealthDailyStorePort,
} from '../ports/wealth-daily.store.port';
import {
	NoActiveConsentError,
	SharedPortfolioService,
} from '../shared-portfolio.service';

export interface RecomputeResult {
	opened: number;
	updated: number;
	resolved: number;
}

/** Motivos de indisponibilidade de uma fonte, gravados no snapshot. */
export const SOURCE_METRICS_FAILED = 'METRICS_FAILED';
export const SOURCE_READ_FAILED = 'SOURCE_READ_FAILED';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** `previous` das regras: alertas do cliente dos últimos 365 dias. */
const PREVIOUS_ALERTS_DAYS = 365;
/** `LARGE_SELLS`: 30 dias corridos, hoje incluído. */
const SELLS_WINDOW_DAYS = 30;

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

const daysBefore = (iso: string, days: number): string => {
	const date = new Date(`${iso}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() - days);
	return isoDate(date);
};

interface BuiltSources {
	sources: SourceSnapshot[];
	/** Fontes que falharam: os alertas delas ficam como estão nesta rodada. */
	frozen: Set<SnapshotSource>;
	/**
	 * Carteiras B2C desta rodada: `none` sem consentimento ativo, `unknown`
	 * quando a leitura falhou.
	 */
	b2c:
		| { kind: 'none' }
		| { kind: 'unknown' }
		| { kind: 'shared'; portfolioIds: Set<string> };
}

/**
 * Read model de atenção de um cliente: monta o snapshot por fonte, grava a
 * linha diária e reconcilia os alertas. Roda como sistema (job diário e
 * gatilho): não é um acesso de assessor, então não autoriza nem audita
 * `advisor.client.accessed`. Idempotente: recomputar o mesmo cliente de novo
 * não abre, muda nem resolve nada.
 */
@Injectable()
export class ClientSnapshotService implements ClientAttentionPurgePort {
	constructor(
		@Inject(ADVISOR_RELATIONSHIP_STORE)
		private readonly relationships: RelationshipStorePort,
		@Inject(ADVISOR_TRANSACTION_STORE)
		private readonly transactions: TransactionStorePort,
		private readonly metrics: PortfolioMetricsService,
		private readonly shared: SharedPortfolioService,
		@Inject(ADVISOR_CLIENT_SNAPSHOT_STORE)
		private readonly snapshots: ClientSnapshotStorePort,
		@Inject(ADVISOR_WEALTH_DAILY_STORE)
		private readonly wealth: WealthDailyStorePort,
		@Inject(ADVISOR_ALERT_STORE) private readonly alerts: AlertStorePort,
		@Inject(ADVISOR_ALERT_SETTINGS_STORE)
		private readonly settings: AlertSettingsStorePort,
		@Inject(ADVISOR_CLIENT_CONTACT_STORE)
		private readonly contacts: ClientContactStorePort
	) {}

	async recompute(
		orgId: string,
		clientProfileId: string,
		now: Date
	): Promise<RecomputeResult> {
		const relationship = await this.relationships.findByOrgAndClient(
			orgId,
			clientProfileId
		);
		if (!relationship || relationship.status !== RelationshipStatus.Active) {
			return this.retire(orgId, clientProfileId, now);
		}

		const today = isoDate(now);
		const previous = await this.snapshots.find(orgId, clientProfileId);
		const built = await this.buildSources(orgId, clientProfileId, now);
		await this.dropStaleSharedRows(orgId, clientProfileId, previous, built);

		const [startedAt, lastContactAt] = await Promise.all([
			this.relationships.findCreatedAt(relationship.id),
			this.contacts.find(orgId, clientProfileId),
		]);
		const relationshipStartedAt = startedAt ?? now;
		const snapshot = this.snapshotOf(
			orgId,
			clientProfileId,
			today,
			built.sources,
			relationshipStartedAt,
			lastContactAt,
			now
		);
		await this.snapshots.upsert(snapshot);
		for (const row of this.dailyRowsOf(snapshot)) {
			await this.wealth.upsert(row);
		}

		const engineEnabledAt = await this.settings.ensureEngineEnabled(orgId, now);
		const stored = await this.settings.find(orgId);
		const contactBaseline = new Date(
			Math.max(
				relationshipStartedAt.getTime(),
				engineEnabledAt.getTime(),
				lastContactAt?.getTime() ?? 0
			)
		);
		const sells = await this.sellsOf(orgId, clientProfileId, today);

		const candidates = evaluateAlerts({
			snapshot,
			sells,
			settings: stored?.settings ?? DEFAULT_ALERT_SETTINGS,
			contactBaseline,
			today,
		}).filter((c) => !isFrozen(c, built.frozen));
		const existing = (
			await this.alerts.listForClient(
				orgId,
				clientProfileId,
				new Date(now.getTime() - PREVIOUS_ALERTS_DAYS * MS_PER_DAY)
			)
		).filter((a) => !isFrozen(a, built.frozen));

		return this.apply(orgId, clientProfileId, candidates, existing, today, now);
	}

	/** LGPD: tudo do cliente, inclusive os alertas manuais. */
	async purgeClient(orgId: string, clientProfileId: string): Promise<void> {
		await this.snapshots.delete(orgId, clientProfileId);
		await this.wealth.deleteClient(orgId, clientProfileId);
		await this.contacts.deleteByClient(orgId, clientProfileId);
		await this.alerts.deleteByClient(orgId, clientProfileId);
	}

	/**
	 * Sem relação ACTIVE: some o read model e os alertas não manuais ativos
	 * viram RESOLVED. Os manuais ficam com o assessor.
	 */
	private async retire(
		orgId: string,
		clientProfileId: string,
		now: Date
	): Promise<RecomputeResult> {
		await this.snapshots.delete(orgId, clientProfileId);
		await this.wealth.deleteClient(orgId, clientProfileId);
		await this.contacts.deleteByClient(orgId, clientProfileId);
		const active = (
			await this.alerts.listForClient(orgId, clientProfileId, now)
		).filter((a) => a.rule !== AlertRule.Manual && isActive(a));
		const resolved =
			active.length === 0
				? 0
				: await this.alerts.resolveMany(
						active.map((a) => a.id),
						now
					);
		return { opened: 0, updated: 0, resolved };
	}

	private async buildSources(
		orgId: string,
		clientProfileId: string,
		now: Date
	): Promise<BuiltSources> {
		const frozen = new Set<SnapshotSource>();
		const sources: SourceSnapshot[] = [];

		try {
			sources.push({
				source: SnapshotSource.AdvisorLedger,
				metrics: await this.metrics.computeForSystem(
					orgId,
					clientProfileId,
					now
				),
			});
		} catch {
			frozen.add(SnapshotSource.AdvisorLedger);
			sources.push({
				source: SnapshotSource.AdvisorLedger,
				metrics: null,
				unavailableReason: SOURCE_METRICS_FAILED,
			});
		}

		try {
			const portfolios = await this.shared.getSharedMetricsForSystem(
				orgId,
				clientProfileId,
				now
			);
			for (const p of portfolios) {
				if (p.metrics === null) frozen.add(SnapshotSource.B2cShared);
				sources.push({
					source: SnapshotSource.B2cShared,
					portfolioId: p.portfolioId,
					metrics: p.metrics,
					...(p.unavailableReason !== undefined && {
						unavailableReason: p.unavailableReason,
					}),
				});
			}
			const portfolioIds = new Set(portfolios.map((p) => p.portfolioId));
			return { sources, frozen, b2c: { kind: 'shared', portfolioIds } };
		} catch (error) {
			if (error instanceof NoActiveConsentError) {
				return { sources, frozen, b2c: { kind: 'none' } };
			}
			frozen.add(SnapshotSource.B2cShared);
			sources.push({
				source: SnapshotSource.B2cShared,
				metrics: null,
				unavailableReason: SOURCE_READ_FAILED,
			});
			return { sources, frozen, b2c: { kind: 'unknown' } };
		}
	}

	/**
	 * Sem consentimento ativo, todas as linhas B2C saem. Com ele, saem as das
	 * carteiras que deixaram de ser compartilhadas. Leitura que falhou não
	 * apaga nada.
	 */
	private async dropStaleSharedRows(
		orgId: string,
		clientProfileId: string,
		previous: ClientSnapshot | null,
		built: BuiltSources
	): Promise<void> {
		const { b2c } = built;
		if (b2c.kind === 'unknown') return;
		if (b2c.kind === 'none') {
			await this.wealth.deleteSource(
				orgId,
				clientProfileId,
				SnapshotSource.B2cShared
			);
			return;
		}
		const stale = new Set(
			(previous?.sources ?? [])
				.filter(
					(s) =>
						s.source === SnapshotSource.B2cShared &&
						s.portfolioId !== undefined &&
						!b2c.portfolioIds.has(s.portfolioId)
				)
				.map((s) => s.portfolioId as string)
		);
		for (const portfolioId of stale) {
			await this.wealth.deleteSource(
				orgId,
				clientProfileId,
				SnapshotSource.B2cShared,
				portfolioId
			);
		}
	}

	private snapshotOf(
		orgId: string,
		clientProfileId: string,
		today: string,
		sources: SourceSnapshot[],
		relationshipStartedAt: Date,
		lastContactAt: Date | null,
		now: Date
	): ClientSnapshot {
		const parts = sources
			.filter((s) => s.metrics !== null)
			.map((s) => partsOf(s.metrics as ClientPortfolioMetrics));
		return {
			orgId,
			clientProfileId,
			asOf: today,
			sources,
			totalMinor: sum(parts.map((p) => p.totalMinor)),
			verifiedMinor: sum(parts.map((p) => p.verifiedMinor)),
			manualMinor: sum(parts.map((p) => p.manualMinor)),
			relationshipStartedAt,
			lastContactAt,
			computedAt: now,
		};
	}

	/** Uma linha por fonte com métricas; a fonte que falhou não grava. */
	private dailyRowsOf(snapshot: ClientSnapshot): WealthDailyRow[] {
		return snapshot.sources
			.filter((s) => s.metrics !== null)
			.map((s) => ({
				orgId: snapshot.orgId,
				clientProfileId: snapshot.clientProfileId,
				date: snapshot.asOf,
				source: s.source,
				...(s.portfolioId !== undefined && { portfolioId: s.portfolioId }),
				...partsOf(s.metrics as ClientPortfolioMetrics),
			}));
	}

	/** Vendas do livro do assessor nos últimos 30 dias corridos. */
	private async sellsOf(
		orgId: string,
		clientProfileId: string,
		today: string
	): Promise<SellWindow> {
		const from = daysBefore(today, SELLS_WINDOW_DAYS - 1);
		const ledger = await this.transactions.listByClient(orgId, clientProfileId);
		const sellsMinor30d = ledger
			.filter(
				(t) =>
					t.side === TransactionSide.Sell &&
					t.tradeDate >= from &&
					t.tradeDate <= today
			)
			.reduce(
				(total, t) => total + t.quantity * t.unitPriceMinor - t.feesMinor,
				0
			);
		return { sellsMinor30d: Math.round(sellsMinor30d) };
	}

	private async apply(
		orgId: string,
		clientProfileId: string,
		candidates: AlertCandidate[],
		existing: Alert[],
		today: string,
		now: Date
	): Promise<RecomputeResult> {
		const plan = reconcileAlerts({ candidates, existing, today });
		const byId = new Map(existing.map((a) => [a.id, a]));

		let updated = 0;
		for (const { id, patch } of plan.update) {
			const current = byId.get(id);
			const changed = current ? changesOf(current, patch) : patch;
			if (Object.keys(changed).length === 0) continue;
			// Só mexe no que segue ativo: o assessor pode ter fechado no meio.
			const result = await this.alerts.patch(id, changed, [
				AlertStatus.Open,
				AlertStatus.Snoozed,
			]);
			if (result) updated += 1;
		}

		const resolved =
			plan.resolve.length === 0
				? 0
				: await this.alerts.resolveMany(plan.resolve, now);

		const opened =
			plan.open.length === 0
				? []
				: await this.alerts.insertMany(
						plan.open.map(
							(c): NewAlert => ({
								...c,
								orgId,
								clientProfileId,
								conditionKey: conditionKeyOf(c),
								status: AlertStatus.Open,
							})
						)
					);

		return { opened: opened.length, updated, resolved };
	}
}

const isActive = (a: Alert): boolean =>
	a.status === AlertStatus.Open || a.status === AlertStatus.Snoozed;

const isFrozen = (
	item: Pick<AlertCandidate, 'source'>,
	frozen: Set<SnapshotSource>
): boolean => item.source !== null && frozen.has(item.source);

const sum = (values: number[]): number =>
	values.reduce((total, v) => total + v, 0);

function partsOf(m: ClientPortfolioMetrics): {
	totalMinor: number;
	verifiedMinor: number;
	manualMinor: number;
} {
	let verifiedMinor = 0;
	let manualMinor = 0;
	for (const p of m.positions) {
		if (p.provenance === Provenance.Verified)
			verifiedMinor += p.marketValueMinor;
		else manualMinor += p.marketValueMinor;
	}
	return { totalMinor: m.totalValueMinor, verifiedMinor, manualMinor };
}

/** Só as chaves que mudam de fato; `undefined` remove um campo presente. */
function changesOf(current: Alert, patch: Partial<Alert>): Partial<Alert> {
	const record = current as unknown as Record<string, unknown>;
	const changed: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(patch)) {
		if (JSON.stringify(record[key]) !== JSON.stringify(value)) {
			changed[key] = value;
		}
	}
	return changed as Partial<Alert>;
}
