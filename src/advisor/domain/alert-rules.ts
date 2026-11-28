import type { ClientPortfolioMetrics } from '../application/metrics/build-portfolio-metrics';
import type { AlertSettings } from './alert-settings';
import { businessDate } from './business-date';
import {
	conditionKeyOf,
	type AlertCandidate,
	type ClientSnapshot,
	type SellWindow,
	type SourceSnapshot,
} from './attention.entities';
import {
	AlertPriority,
	AlertRule,
	AssetClass,
	PortfolioProvenance,
	Provenance,
	SnapshotSource,
} from './enums';

export interface EvaluateAlertsInput {
	snapshot: ClientSnapshot;
	sells: SellWindow;
	settings: AlertSettings;
	/** max(início do relacionamento, motor ligado, último contato). */
	contactBaseline: Date;
	/** YYYY-MM-DD. */
	today: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STALE_PRICE_DAYS = 3;
const LOW_COVERAGE_PCT = 80;

const ORDER: AlertPriority[] = [
	AlertPriority.P0,
	AlertPriority.P1,
	AlertPriority.P2,
	AlertPriority.P3,
];

/** Faixa 1 e faixa 2 de cada regra. */
const BANDS: Record<
	Exclude<AlertRule, AlertRule.Manual | AlertRule.LargeSells>,
	[AlertPriority, AlertPriority]
> = {
	[AlertRule.PositionDrop]: [AlertPriority.P1, AlertPriority.P0],
	[AlertRule.PortfolioDrawdown]: [AlertPriority.P2, AlertPriority.P1],
	[AlertRule.Concentration]: [AlertPriority.P2, AlertPriority.P1],
	[AlertRule.TargetDrift]: [AlertPriority.P3, AlertPriority.P2],
	[AlertRule.NoContact]: [AlertPriority.P3, AlertPriority.P2],
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

const daysBetweenDates = (from: string, to: string): number =>
	Math.round(
		(Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
			MS_PER_DAY
	);

/** Um nível em direção a P3; P3 fica em P3. */
export function downgrade(priority: AlertPriority): AlertPriority {
	const idx = ORDER.indexOf(priority);
	return ORDER[Math.min(idx + 1, ORDER.length - 1)];
}

/** 0 = abaixo do limite, 1 ou 2 = faixa atingida. */
function bandOf(
	value: number,
	[lighter, severe]: [number, number],
	inclusive: boolean
): 0 | 1 | 2 {
	const hit = (limit: number): boolean =>
		inclusive ? value >= limit : value > limit;
	if (hit(severe)) return 2;
	if (hit(lighter)) return 1;
	return 0;
}

interface Draft {
	rule: AlertRule;
	source: SnapshotSource | null;
	key: string;
	band: 1 | 2;
	priority: AlertPriority;
	params: Record<string, string | number>;
	evidence: Record<string, string | number | null>;
	dataAsOf: string;
	provenance: PortfolioProvenance | null;
	lowConfidence: boolean;
}

function build(d: Draft): AlertCandidate {
	return {
		rule: d.rule,
		source: d.source,
		key: d.key,
		band: d.band,
		priority: d.lowConfidence ? downgrade(d.priority) : d.priority,
		messageKey: `advisor.alert.${d.rule.toLowerCase()}`,
		params: d.params,
		evidence: d.evidence,
		dataAsOf: d.dataAsOf,
		provenance: d.provenance,
		lowConfidence: d.lowConfidence,
	};
}

const lowCoverage = (m: ClientPortfolioMetrics): boolean =>
	m.performance.coveragePct < LOW_COVERAGE_PCT;

const portfolioLevelLowConfidence = (m: ClientPortfolioMetrics): boolean =>
	m.provenance === PortfolioProvenance.Manual ||
	m.provenance === PortfolioProvenance.Partial ||
	lowCoverage(m);

function positionRules(
	s: SourceSnapshot,
	m: ClientPortfolioMetrics,
	settings: AlertSettings,
	today: string
): AlertCandidate[] {
	const out: AlertCandidate[] = [];
	const coverageLow = lowCoverage(m);
	for (const p of m.positions) {
		const stale =
			p.lastCloseDate !== null &&
			daysBetweenDates(p.lastCloseDate, today) > STALE_PRICE_DAYS;
		const lowConfidence =
			p.provenance === Provenance.Manual || stale || coverageLow;
		const provenance =
			p.provenance === Provenance.Manual
				? PortfolioProvenance.Manual
				: PortfolioProvenance.Verified;
		const dataAsOf = p.lastCloseDate ?? m.asOf;

		if (p.change5dPct !== null) {
			const drop = -p.change5dPct;
			const band = bandOf(drop, settings.positionDropPct, true);
			if (band !== 0) {
				out.push(
					build({
						rule: AlertRule.PositionDrop,
						source: s.source,
						key: p.symbol,
						band,
						priority: BANDS[AlertRule.PositionDrop][band - 1],
						params: { symbol: p.symbol, dropPct: round2(drop) },
						evidence: {
							change5dPct: p.change5dPct,
							lastCloseDate: p.lastCloseDate,
							weightPct: p.weightPct,
						},
						dataAsOf,
						provenance,
						lowConfidence,
					})
				);
			}
		}

		const cBand = bandOf(p.weightPct, settings.concentrationPct, false);
		if (cBand !== 0) {
			out.push(
				build({
					rule: AlertRule.Concentration,
					source: s.source,
					key: p.symbol,
					band: cBand,
					priority: BANDS[AlertRule.Concentration][cBand - 1],
					params: { symbol: p.symbol, weightPct: round2(p.weightPct) },
					evidence: {
						weightPct: p.weightPct,
						priced: p.priced ? 1 : 0,
						lastCloseDate: p.lastCloseDate,
					},
					dataAsOf,
					provenance,
					lowConfidence,
				})
			);
		}
	}
	return out;
}

function portfolioRules(
	s: SourceSnapshot,
	m: ClientPortfolioMetrics,
	settings: AlertSettings
): AlertCandidate[] {
	const out: AlertCandidate[] = [];
	const lowConfidence = portfolioLevelLowConfidence(m);
	const common = {
		source: s.source,
		dataAsOf: m.asOf,
		provenance: m.provenance,
		lowConfidence,
	};

	const dd = m.risk.unavailable === null ? m.risk.currentDrawdown : null;
	if (dd !== null) {
		const pct = dd * 100;
		const band = bandOf(pct, settings.portfolioDrawdownPct, true);
		if (band !== 0) {
			out.push(
				build({
					...common,
					rule: AlertRule.PortfolioDrawdown,
					key: 'portfolio',
					band,
					priority: BANDS[AlertRule.PortfolioDrawdown][band - 1],
					params: { drawdownPct: round2(pct) },
					evidence: {
						currentDrawdown: dd,
						peakDate: m.risk.drawdownPeakDate,
					},
				})
			);
		}
	}

	const drift = m.allocation.driftPp;
	if (m.allocation.target !== null && drift !== null) {
		for (const cls of Object.values(AssetClass)) {
			const pp = drift[cls];
			if (typeof pp !== 'number') continue;
			const band = bandOf(Math.abs(pp), settings.targetDriftPp, false);
			if (band === 0) continue;
			out.push(
				build({
					...common,
					rule: AlertRule.TargetDrift,
					key: cls,
					band,
					priority: BANDS[AlertRule.TargetDrift][band - 1],
					params: { assetClass: cls, driftPp: round2(pp) },
					evidence: {
						driftPp: pp,
						currentPct: m.allocation.current[cls] ?? 0,
						targetPct: m.allocation.target[cls] ?? 0,
					},
				})
			);
		}
	}
	return out;
}

function largeSells(
	s: SourceSnapshot,
	m: ClientPortfolioMetrics,
	sells: SellWindow,
	settings: AlertSettings
): AlertCandidate[] {
	if (s.source !== SnapshotSource.AdvisorLedger) return [];
	if (m.totalValueMinor <= 0 || sells.sellsMinor30d <= 0) return [];
	const pct = (sells.sellsMinor30d / m.totalValueMinor) * 100;
	if (pct <= settings.largeSellsPct) return [];
	return [
		build({
			rule: AlertRule.LargeSells,
			source: s.source,
			key: 'portfolio',
			band: 1,
			priority: AlertPriority.P1,
			params: { windowPct: round2(pct) },
			evidence: {
				sellsMinor30d: sells.sellsMinor30d,
				totalValueMinor: m.totalValueMinor,
			},
			dataAsOf: m.asOf,
			provenance: m.provenance,
			lowConfidence: portfolioLevelLowConfidence(m),
		}),
	];
}

function noContact(
	contactBaseline: Date,
	today: string,
	settings: AlertSettings
): AlertCandidate[] {
	const days = Math.floor(
		(Date.parse(`${today}T00:00:00.000Z`) - contactBaseline.getTime()) /
			MS_PER_DAY
	);
	const band = bandOf(days, settings.noContactDays, false);
	if (band === 0) return [];
	return [
		build({
			rule: AlertRule.NoContact,
			source: null,
			key: 'client',
			band,
			priority: BANDS[AlertRule.NoContact][band - 1],
			params: { days },
			evidence: { days, since: businessDate(contactBaseline) },
			dataAsOf: today,
			provenance: null,
			lowConfidence: false,
		}),
	];
}

/** Carteira compartilhada: `portfolioId` logo depois de `source`. */
function withPortfolio(c: AlertCandidate, portfolioId: string): AlertCandidate {
	const { rule, source, ...rest } = c;
	return { rule, source, portfolioId, ...rest };
}

export function evaluateAlerts(input: EvaluateAlertsInput): AlertCandidate[] {
	const { snapshot, sells, settings, contactBaseline, today } = input;
	const out: AlertCandidate[] = [];
	for (const s of snapshot.sources) {
		const m = s.metrics;
		if (m === null) continue;
		const fromSource = [
			...positionRules(s, m, settings, today),
			...portfolioRules(s, m, settings),
			...largeSells(s, m, sells, settings),
		];
		out.push(
			...(s.source === SnapshotSource.B2cShared && s.portfolioId
				? fromSource.map((c) => withPortfolio(c, s.portfolioId as string))
				: fromSource)
		);
	}
	out.push(...noContact(contactBaseline, today, settings));
	return out;
}

/** Regras que dependem das métricas de uma fonte (todas menos NO_CONTACT). */
const SOURCE_RULES = [
	AlertRule.PositionDrop,
	AlertRule.Concentration,
	AlertRule.PortfolioDrawdown,
	AlertRule.TargetDrift,
	AlertRule.LargeSells,
] as const;

/**
 * R27: condições cuja entrada da regra está indisponível nesta rodada, sem
 * que a fonte tenha lançado erro. Valem como fonte congelada: a ausência do
 * candidato não resolve nem limpa (`clear`) o alerta dessa condição.
 * - métricas `null`: todas as condições da fonte;
 * - POSITION_DROP: posição presente sem `change5dPct` (sem preço);
 * - PORTFOLIO_DRAWDOWN: `currentDrawdown` `null` ou risco indisponível;
 * - TARGET_DRIFT: meta presente com `driftPp` `null` (todas as classes da
 *   fonte).
 * Uma posição que saiu da carteira ou uma meta removida (R29) não está
 * indisponível: a condição sumiu, então resolve e limpa.
 */
export function unavailableRuleInputs(
	snapshot: ClientSnapshot
): (conditionKey: string) => boolean {
	const exact = new Set<string>();
	const prefixes: string[] = [];
	const keyOf = (s: SourceSnapshot, rule: AlertRule, key: string): string =>
		conditionKeyOf({ rule, source: s.source, portfolioId: s.portfolioId, key });

	for (const s of snapshot.sources) {
		const m = s.metrics;
		if (m === null) {
			for (const rule of SOURCE_RULES) prefixes.push(keyOf(s, rule, ''));
			continue;
		}
		for (const p of m.positions) {
			if (p.change5dPct === null) {
				exact.add(keyOf(s, AlertRule.PositionDrop, p.symbol));
			}
		}
		if (m.risk.unavailable !== null || m.risk.currentDrawdown === null) {
			exact.add(keyOf(s, AlertRule.PortfolioDrawdown, 'portfolio'));
		}
		if (m.allocation.target !== null && m.allocation.driftPp === null) {
			prefixes.push(keyOf(s, AlertRule.TargetDrift, ''));
		}
	}
	return (conditionKey) =>
		exact.has(conditionKey) || prefixes.some((p) => conditionKey.startsWith(p));
}
