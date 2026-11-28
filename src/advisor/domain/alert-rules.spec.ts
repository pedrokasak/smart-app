import type { ClientPortfolioMetrics } from '../application/metrics/build-portfolio-metrics';
import { DEFAULT_ALERT_SETTINGS } from './alert-settings';
import { evaluateAlerts, unavailableRuleInputs } from './alert-rules';
import {
	ClientSnapshot,
	conditionKeyOf,
	SourceSnapshot,
} from './attention.entities';
import {
	AlertPriority,
	AlertRule,
	AssetClass,
	LiquidityBucket,
	PortfolioProvenance,
	Provenance,
	SnapshotSource,
} from './enums';
import type { ValuedPosition } from './snapshot-metrics';

const TODAY = '2026-11-23';
const DAY = 24 * 60 * 60 * 1000;

const position = (over: Partial<ValuedPosition> = {}): ValuedPosition => ({
	symbol: 'PETR4',
	assetClass: AssetClass.Stock,
	quantity: 1,
	costMinor: 0,
	provenance: Provenance.Verified,
	marketValueMinor: 1000,
	priced: true,
	weightPct: 10,
	change5dPct: 0,
	lastCloseDate: TODAY,
	...over,
});

const zeroClasses = (): Record<AssetClass, number> =>
	Object.fromEntries(Object.values(AssetClass).map((c) => [c, 0])) as Record<
		AssetClass,
		number
	>;

const metrics = (
	over: Partial<ClientPortfolioMetrics> = {}
): ClientPortfolioMetrics => ({
	asOf: TODAY,
	currency: 'BRL',
	provenance: PortfolioProvenance.Verified,
	totalValueMinor: 1_000_000,
	positions: [],
	concentration: { hhi: null, effectiveAssets: null, top: [] },
	liquidity: Object.fromEntries(
		Object.values(LiquidityBucket).map((b) => [b, 0])
	) as Record<LiquidityBucket, number>,
	allocation: { current: zeroClasses(), target: null, driftPp: null },
	performance: {
		twr: null,
		twrAnnualized: null,
		mwr: null,
		mwrAnnualized: null,
		measuredFrom: null,
		measuredTo: null,
		observations: 0,
		coveragePct: 100,
		unavailable: null,
	},
	risk: {
		volatilityAnnualized: null,
		maxDrawdown: -0.5,
		currentDrawdown: 0,
		drawdownPeakDate: null,
		drawdownTroughDate: null,
		var95: null,
		unavailable: null,
	},
	benchmarks: [],
	warnings: {
		unpricedSymbols: [],
		ledgerInconsistencies: [],
		noHistorySymbols: [],
	},
	...over,
});

const source = (
	m: ClientPortfolioMetrics | null,
	src = SnapshotSource.AdvisorLedger
): SourceSnapshot => ({ source: src, metrics: m });

const snapshot = (...sources: SourceSnapshot[]): ClientSnapshot => ({
	orgId: 'o',
	clientProfileId: 'c',
	asOf: TODAY,
	sources,
	totalMinor: 0,
	verifiedMinor: 0,
	manualMinor: 0,
	relationshipStartedAt: new Date('2020-01-01'),
	lastContactAt: null,
	computedAt: new Date(),
});

const FRESH_BASELINE = new Date(`${TODAY}T00:00:00.000Z`);
const baselineDaysAgo = (n: number): Date =>
	new Date(Date.parse(`${TODAY}T00:00:00.000Z`) - n * DAY);

const run = (
	sources: SourceSnapshot[],
	over: {
		sellsMinor30d?: number;
		settings?: Partial<typeof DEFAULT_ALERT_SETTINGS>;
		baseline?: Date;
	} = {}
) =>
	evaluateAlerts({
		snapshot: snapshot(...sources),
		sells: { sellsMinor30d: over.sellsMinor30d ?? 0 },
		settings: { ...DEFAULT_ALERT_SETTINGS, ...over.settings },
		contactBaseline: over.baseline ?? FRESH_BASELINE,
		today: TODAY,
	});

const only = (
	list: ReturnType<typeof run>,
	rule: AlertRule
): ReturnType<typeof run> => list.filter((a) => a.rule === rule);

describe('evaluateAlerts', () => {
	it('is silent on a healthy portfolio', () => {
		expect(run([source(metrics({ positions: [position()] }))])).toEqual([]);
	});

	describe('POSITION_DROP', () => {
		const drop = (change5dPct: number, over: Partial<ValuedPosition> = {}) =>
			only(
				run([
					source(metrics({ positions: [position({ change5dPct, ...over })] })),
				]),
				AlertRule.PositionDrop
			);

		it('a 12% drop is band 1, P1', () => {
			const [a, ...rest] = drop(-12);
			expect(rest).toEqual([]);
			expect(a).toMatchObject({
				band: 1,
				priority: AlertPriority.P1,
				key: 'PETR4',
				source: SnapshotSource.AdvisorLedger,
				lowConfidence: false,
				dataAsOf: TODAY,
			});
		});

		it('a 22% drop is band 2, P0', () => {
			expect(drop(-22)[0]).toMatchObject({
				band: 2,
				priority: AlertPriority.P0,
			});
		});

		it('exactly the limit fires; below it does not; a rise never does', () => {
			expect(drop(-10)).toHaveLength(1);
			expect(drop(-9.99)).toHaveLength(0);
			expect(drop(15)).toHaveLength(0);
			expect(drop(null as unknown as number)).toHaveLength(0);
		});

		it('a MANUAL position drops one level', () => {
			expect(drop(-22, { provenance: Provenance.Manual })[0]).toMatchObject({
				priority: AlertPriority.P1,
				lowConfidence: true,
				provenance: PortfolioProvenance.Manual,
			});
		});

		it('a price 5 days old drops one level; 3 days does not', () => {
			expect(drop(-22, { lastCloseDate: '2026-11-18' })[0]).toMatchObject({
				priority: AlertPriority.P1,
				lowConfidence: true,
				dataAsOf: '2026-11-18',
			});
			expect(drop(-22, { lastCloseDate: '2026-11-20' })[0]).toMatchObject({
				priority: AlertPriority.P0,
				lowConfidence: false,
			});
		});

		it('coverage under 80 drops one level', () => {
			const m = metrics({
				positions: [position({ change5dPct: -22 })],
			});
			m.performance.coveragePct = 79;
			expect(only(run([source(m)]), AlertRule.PositionDrop)[0].priority).toBe(
				AlertPriority.P1
			);
			m.performance.coveragePct = 80;
			expect(only(run([source(m)]), AlertRule.PositionDrop)[0].priority).toBe(
				AlertPriority.P0
			);
		});

		it('honours custom thresholds', () => {
			const list = only(
				run([source(metrics({ positions: [position({ change5dPct: -4 })] }))], {
					settings: { positionDropPct: [3, 6] },
				}),
				AlertRule.PositionDrop
			);
			expect(list[0]).toMatchObject({ band: 1, priority: AlertPriority.P1 });
		});
	});

	describe('CONCENTRATION', () => {
		const conc = (weightPct: number, over: Partial<ValuedPosition> = {}) =>
			only(
				run([
					source(metrics({ positions: [position({ weightPct, ...over })] })),
				]),
				AlertRule.Concentration
			);

		it('30% is P2 and 40% is P1; 25% exactly does not fire', () => {
			expect(conc(30)[0]).toMatchObject({
				band: 1,
				priority: AlertPriority.P2,
				key: 'PETR4',
			});
			expect(conc(40)[0]).toMatchObject({
				band: 2,
				priority: AlertPriority.P1,
			});
			expect(conc(25)).toHaveLength(0);
		});

		it('is evaluated per source: the same symbol is not added up', () => {
			const a = metrics({ positions: [position({ weightPct: 20 })] });
			const b = metrics({ positions: [position({ weightPct: 20 })] });
			expect(
				only(
					run([source(a), source(b, SnapshotSource.B2cShared)]),
					AlertRule.Concentration
				)
			).toEqual([]);
		});

		it('fires per source with the source in the key', () => {
			const list = only(
				run([
					source(metrics({ positions: [position({ weightPct: 30 })] })),
					source(
						metrics({ positions: [position({ weightPct: 30 })] }),
						SnapshotSource.B2cShared
					),
				]),
				AlertRule.Concentration
			);
			expect(list.map(conditionKeyOf)).toEqual([
				'CONCENTRATION:ADVISOR_LEDGER:PETR4',
				'CONCENTRATION:B2C_SHARED:PETR4',
			]);
		});

		it('each shared B2C portfolio is its own source: same symbol, two keys', () => {
			const shared = (portfolioId: string): SourceSnapshot => ({
				source: SnapshotSource.B2cShared,
				portfolioId,
				metrics: metrics({ positions: [position({ weightPct: 30 })] }),
			});
			const list = only(
				run([shared('p1'), shared('p2')]),
				AlertRule.Concentration
			);
			expect(list.map((c) => c.portfolioId)).toEqual(['p1', 'p2']);
			expect(list.map(conditionKeyOf)).toEqual([
				'CONCENTRATION:B2C_SHARED/p1:PETR4',
				'CONCENTRATION:B2C_SHARED/p2:PETR4',
			]);
		});

		it('the advisor ledger carries no portfolioId', () => {
			const [c] = only(
				run([source(metrics({ positions: [position({ weightPct: 30 })] }))]),
				AlertRule.Concentration
			);
			expect('portfolioId' in c).toBe(false);
		});

		it('an unpriced position still fires, with a null close date', () => {
			expect(
				conc(40, { priced: false, lastCloseDate: null, change5dPct: null })[0]
			).toMatchObject({
				priority: AlertPriority.P1,
				dataAsOf: TODAY,
				lowConfidence: false,
			});
		});
	});

	describe('TARGET_DRIFT', () => {
		const drift = (pp: number, target: boolean = true) => {
			const m = metrics();
			if (target) {
				m.allocation.target = { [AssetClass.Stock]: 50 };
				m.allocation.driftPp = { ...zeroClasses(), [AssetClass.Stock]: pp };
			}
			return only(run([source(m)]), AlertRule.TargetDrift);
		};

		it('7pp is P3 and 12pp is P2, in either direction', () => {
			expect(drift(7)[0]).toMatchObject({
				band: 1,
				priority: AlertPriority.P3,
				key: AssetClass.Stock,
			});
			expect(drift(-12)[0]).toMatchObject({
				band: 2,
				priority: AlertPriority.P2,
			});
			expect(drift(5)).toHaveLength(0);
		});

		it('does not fire without a target', () => {
			expect(drift(50, false)).toEqual([]);
		});
	});

	describe('PORTFOLIO_DRAWDOWN', () => {
		const dd = (
			currentDrawdown: number | null,
			over: Partial<ClientPortfolioMetrics> = {}
		) =>
			only(
				run([
					source(
						metrics({
							risk: { ...metrics().risk, currentDrawdown },
							...over,
						})
					),
				]),
				AlertRule.PortfolioDrawdown
			);

		it('0.09 is P2, 0.16 is P1, 0.07 is silent', () => {
			expect(dd(0.09)[0]).toMatchObject({
				band: 1,
				priority: AlertPriority.P2,
				key: 'portfolio',
			});
			expect(dd(0.16)[0]).toMatchObject({
				band: 2,
				priority: AlertPriority.P1,
			});
			expect(dd(0.07)).toEqual([]);
		});

		it('a PARTIAL source drops it to P3, and P3 never goes lower', () => {
			const partial = dd(0.09, { provenance: PortfolioProvenance.Partial });
			expect(partial[0]).toMatchObject({
				priority: AlertPriority.P3,
				lowConfidence: true,
				provenance: PortfolioProvenance.Partial,
			});
			const m = metrics({ provenance: PortfolioProvenance.Manual });
			m.allocation.target = { [AssetClass.Stock]: 50 };
			m.allocation.driftPp = { ...zeroClasses(), [AssetClass.Stock]: 7 };
			const drift = only(run([source(m)]), AlertRule.TargetDrift);
			expect(drift[0].priority).toBe(AlertPriority.P3);
			expect(drift[0].lowConfidence).toBe(true);
		});

		it('never uses maxDrawdown', () => {
			expect(dd(0)).toEqual([]);
		});

		it('INSUFFICIENT_HISTORY or a null value does not fire', () => {
			const m = metrics();
			m.risk = {
				...m.risk,
				currentDrawdown: 0.3,
				unavailable: 'INSUFFICIENT_HISTORY',
			};
			expect(only(run([source(m)]), AlertRule.PortfolioDrawdown)).toEqual([]);
			expect(dd(null)).toEqual([]);
		});
	});

	describe('LARGE_SELLS', () => {
		const sells = (minor: number, src = SnapshotSource.AdvisorLedger) =>
			only(
				run([source(metrics(), src)], { sellsMinor30d: minor }),
				AlertRule.LargeSells
			);

		it('21% of the book is P1', () => {
			expect(sells(210_000)[0]).toMatchObject({
				band: 1,
				priority: AlertPriority.P1,
				source: SnapshotSource.AdvisorLedger,
				evidence: expect.objectContaining({ sellsMinor30d: 210_000 }),
			});
		});

		it('20% exactly does not fire', () => {
			expect(sells(200_000)).toEqual([]);
		});

		it('the shared B2C portfolio never produces it', () => {
			expect(sells(900_000, SnapshotSource.B2cShared)).toEqual([]);
		});

		it('an empty book does not divide by zero', () => {
			const m = metrics({ totalValueMinor: 0 });
			expect(
				only(run([source(m)], { sellsMinor30d: 10 }), AlertRule.LargeSells)
			).toEqual([]);
		});
	});

	describe('NO_CONTACT', () => {
		const nc = (days: number, settings = {}) =>
			only(
				run([], { baseline: baselineDaysAgo(days), settings }),
				AlertRule.NoContact
			);

		it('91 days is P3 and 181 days is P2; 90 does not fire', () => {
			expect(nc(91)[0]).toMatchObject({
				band: 1,
				priority: AlertPriority.P3,
				source: null,
				key: 'client',
				provenance: null,
				lowConfidence: false,
				params: { days: 91 },
			});
			expect(nc(181)[0]).toMatchObject({
				band: 2,
				priority: AlertPriority.P2,
			});
			expect(nc(90)).toEqual([]);
		});

		it('honours noContactDays [60, 120]', () => {
			expect(nc(61, { noContactDays: [60, 120] })[0]).toMatchObject({
				priority: AlertPriority.P3,
			});
			expect(nc(60, { noContactDays: [60, 120] })).toEqual([]);
		});

		it('fires with no sources at all', () => {
			expect(conditionKeyOf(nc(91)[0])).toBe('NO_CONTACT:-:client');
		});
	});

	describe('missing metrics', () => {
		it('metrics: null generates nothing for that source', () => {
			const list = run([
				source(null),
				source(
					metrics({ positions: [position({ weightPct: 40 })] }),
					SnapshotSource.B2cShared
				),
			]);
			expect(list.map((a) => a.source)).toEqual([SnapshotSource.B2cShared]);
		});

		it('metrics: null with huge sells generates nothing', () => {
			expect(run([source(null)], { sellsMinor30d: 1e9 })).toEqual([]);
		});
	});

	it('B4: no message key or param/evidence key suggests buying, selling or switching', () => {
		const m = metrics({
			positions: [position({ change5dPct: -25, weightPct: 40 })],
			risk: { ...metrics().risk, currentDrawdown: 0.2 },
		});
		m.allocation.target = { [AssetClass.Stock]: 10 };
		m.allocation.driftPp = { ...zeroClasses(), [AssetClass.Stock]: 15 };
		const list = run([source(m)], {
			sellsMinor30d: 500_000,
			baseline: baselineDaysAgo(200),
		});
		expect(new Set(list.map((a) => a.rule))).toEqual(
			new Set([
				AlertRule.PositionDrop,
				AlertRule.Concentration,
				AlertRule.PortfolioDrawdown,
				AlertRule.TargetDrift,
				AlertRule.LargeSells,
				AlertRule.NoContact,
			])
		);
		const allowed = new Set(['advisor.alert.large_sells', 'sellsMinor30d']);
		const forbidden = /buy|sell|compra|venda|troca|switch/i;
		for (const a of list) {
			const names = [
				a.messageKey,
				...Object.keys(a.params),
				...Object.keys(a.evidence),
			];
			for (const name of names) {
				if (allowed.has(name)) continue;
				expect(name).not.toMatch(forbidden);
			}
		}
		const sellsAlert = list.find((a) => a.rule === AlertRule.LargeSells)!;
		expect(Object.keys(sellsAlert.params)).toEqual(['windowPct']);
	});
});

describe('unavailableRuleInputs (R27)', () => {
	const key = (
		rule: AlertRule,
		k: string,
		src = SnapshotSource.AdvisorLedger,
		portfolioId?: string
	) => conditionKeyOf({ rule, source: src, key: k, portfolioId });

	it('a position without change5dPct makes its POSITION_DROP unavailable, only that one', () => {
		const isUnavailable = unavailableRuleInputs(
			snapshot(
				source(
					metrics({
						positions: [
							position({ symbol: 'PETR4', change5dPct: null, priced: false }),
							position({ symbol: 'VALE3', change5dPct: -3 }),
						],
					})
				)
			)
		);
		expect(isUnavailable(key(AlertRule.PositionDrop, 'PETR4'))).toBe(true);
		expect(isUnavailable(key(AlertRule.PositionDrop, 'VALE3'))).toBe(false);
		expect(isUnavailable(key(AlertRule.Concentration, 'PETR4'))).toBe(false);
		// Posição que saiu da carteira: a condição sumiu de fato.
		expect(isUnavailable(key(AlertRule.PositionDrop, 'ITUB4'))).toBe(false);
	});

	it('a null currentDrawdown (or risk unavailable) makes PORTFOLIO_DRAWDOWN unavailable', () => {
		const base = metrics().risk;
		for (const risk of [
			{ ...base, currentDrawdown: null },
			{ ...base, unavailable: 'INSUFFICIENT_HISTORY' },
		]) {
			const isUnavailable = unavailableRuleInputs(
				snapshot(source(metrics({ risk } as Partial<ClientPortfolioMetrics>)))
			);
			expect(isUnavailable(key(AlertRule.PortfolioDrawdown, 'portfolio'))).toBe(
				true
			);
		}
		expect(
			unavailableRuleInputs(snapshot(source(metrics())))(
				key(AlertRule.PortfolioDrawdown, 'portfolio')
			)
		).toBe(false);
	});

	it('no target or a null driftPp makes every TARGET_DRIFT of the source unavailable', () => {
		const isUnavailable = unavailableRuleInputs(snapshot(source(metrics())));
		expect(isUnavailable(key(AlertRule.TargetDrift, AssetClass.Stock))).toBe(
			true
		);
		const withTarget = unavailableRuleInputs(
			snapshot(
				source(
					metrics({
						allocation: {
							current: zeroClasses(),
							target: { [AssetClass.Stock]: 50 },
							driftPp: zeroClasses(),
						},
					})
				)
			)
		);
		expect(withTarget(key(AlertRule.TargetDrift, AssetClass.Stock))).toBe(
			false
		);
	});

	it('null metrics make every condition of that source unavailable, and only that source', () => {
		const isUnavailable = unavailableRuleInputs(
			snapshot(
				{ source: SnapshotSource.B2cShared, portfolioId: 'p1', metrics: null },
				{
					source: SnapshotSource.B2cShared,
					portfolioId: 'p2',
					metrics: metrics(),
				}
			)
		);
		const b2c = SnapshotSource.B2cShared;
		expect(
			isUnavailable(key(AlertRule.Concentration, 'PETR4', b2c, 'p1'))
		).toBe(true);
		expect(
			isUnavailable(key(AlertRule.LargeSells, 'portfolio', b2c, 'p1'))
		).toBe(true);
		expect(
			isUnavailable(key(AlertRule.Concentration, 'PETR4', b2c, 'p2'))
		).toBe(false);
		expect(
			isUnavailable(
				conditionKeyOf({
					rule: AlertRule.NoContact,
					source: null,
					key: 'client',
				})
			)
		).toBe(false);
	});
});
