import {
	AssetClass,
	PortfolioProvenance,
	Provenance,
	TransactionSide,
	TransactionSource,
} from '../../domain/enums';
import { Transaction } from '../../domain/portfolio.entities';
import type { DailyCloseMinor } from '../ports/price-history.port';
import {
	buildPortfolioMetrics,
	ClientPortfolioMetrics,
	measuredWindow,
} from './build-portfolio-metrics';
import { isTradingDay } from './portfolio-math';

const addDay = (iso: string): string => {
	const date = new Date(`${iso}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
};

/** n pregões B3 a partir de `from` (inclusive, se for pregão). */
const tradingDays = (from: string, n: number): string[] => {
	const days: string[] = [];
	for (let day = from; days.length < n; day = addDay(day)) {
		if (isTradingDay(day)) days.push(day);
	}
	return days;
};

const rising = (
	days: string[],
	startMinor: number,
	dailyRate: number
): DailyCloseMinor[] =>
	days.map((date, i) => ({
		date,
		closeMinor: Math.round(startMinor * (1 + dailyRate) ** i),
	}));

let seq = 0;
const tx = (over: Partial<Transaction> = {}): Transaction => {
	seq += 1;
	return {
		id: `tx-${seq}`,
		createdAt: new Date(2025, 0, 1, 0, 0, seq),
		orgId: 'orgA',
		clientProfileId: 'clientA',
		symbol: 'PETR4',
		assetClass: AssetClass.Stock,
		side: TransactionSide.Buy,
		quantity: 10,
		unitPriceMinor: 10000,
		feesMinor: 0,
		currency: 'BRL',
		tradeDate: '2025-05-05',
		provenance: Provenance.Verified,
		source: TransactionSource.CsvImport,
		createdByUserId: 'user-1',
		...over,
	};
};

const numbersIn = (value: unknown): number[] => {
	if (typeof value === 'number') return [value];
	if (value && typeof value === 'object') {
		return Object.values(value).flatMap(numbersIn);
	}
	return [];
};

const expectNoNaN = (metrics: ClientPortfolioMetrics): void => {
	const numbers = numbersIn(metrics);
	expect(numbers.length).toBeGreaterThan(0);
	expect(numbers.filter((n) => Number.isNaN(n))).toEqual([]);
};

/** Livro inconsistente: o snapshot sai, a série não é calculada. */
const expectSeriesRefused = (m: ClientPortfolioMetrics): void => {
	expect(m.performance).toEqual({
		twr: null,
		twrAnnualized: null,
		mwr: null,
		measuredFrom: null,
		measuredTo: null,
		observations: 0,
		unavailable: 'INCONSISTENT_LEDGER',
	});
	expect(m.risk).toEqual({
		volatilityAnnualized: null,
		maxDrawdown: null,
		drawdownPeakDate: null,
		drawdownTroughDate: null,
		var95: null,
		unavailable: 'INCONSISTENT_LEDGER',
	});
	expect(m.benchmarks.every((b) => b.excess === null)).toBe(true);
	expect(m.positions.length).toBeGreaterThan(0);
	expect(m.totalValueMinor).toBeGreaterThan(0);
	expect(m.concentration.hhi).not.toBeNull();
	expect(m.concentration.top.length).toBeGreaterThan(0);
	expect(m.liquidity.D1_2).toBe(100);
};

const build = (over: {
	asOf: string;
	ledger: Transaction[];
	closes?: Map<string, DailyCloseMinor[]>;
	target?: Partial<Record<AssetClass, number>> | null;
	benchmarkReturns?: Parameters<
		typeof buildPortfolioMetrics
	>[0]['benchmarkReturns'];
}): ClientPortfolioMetrics =>
	buildPortfolioMetrics({
		closes: new Map(),
		target: null,
		benchmarkReturns: {},
		...over,
	});

describe('buildPortfolioMetrics', () => {
	const days31 = tradingDays('2025-05-05', 31);
	const asOf31 = days31[days31.length - 1];

	it('reports NO_TRANSACTIONS for an empty ledger, with no NaN anywhere', () => {
		const m = build({ asOf: '2025-06-30', ledger: [] });

		expect(m.performance.unavailable).toBe('NO_TRANSACTIONS');
		expect(m.risk.unavailable).toBe('NO_TRANSACTIONS');
		expect(m.totalValueMinor).toBe(0);
		expect(m.provenance).toBeNull();
		expect(m.currency).toBe('BRL');
		expect(m.asOf).toBe('2025-06-30');
		expect(m.benchmarks).toEqual([
			{ key: 'CDI', periodReturn: null, excess: null },
			{ key: 'IBOV', periodReturn: null, excess: null },
			{ key: 'IPCA', periodReturn: null, excess: null },
		]);
		expectNoNaN(m);
	});

	it('reports INSUFFICIENT_HISTORY with 10 sessions but keeps the snapshot', () => {
		const days = tradingDays('2025-05-05', 10);
		const m = build({
			asOf: days[9],
			ledger: [tx({ tradeDate: days[0] })],
			closes: new Map([['PETR4', rising(days, 10000, 0.01)]]),
		});

		expect(m.performance.unavailable).toBe('INSUFFICIENT_HISTORY');
		expect(m.performance.twr).toBeNull();
		expect(m.performance.twrAnnualized).toBeNull();
		expect(m.performance.mwr).toBeNull();
		expect(m.performance.observations).toBe(9);
		expect(m.risk.unavailable).toBe('INSUFFICIENT_HISTORY');
		expect(m.risk.volatilityAnnualized).toBeNull();
		expect(m.risk.var95).toBeNull();
		expect(m.positions).toHaveLength(1);
		expect(m.positions[0].priced).toBe(true);
		expect(m.concentration.hhi).toBe(1);
		expect(m.concentration.top).toEqual([{ symbol: 'PETR4', weightPct: 100 }]);
		expect(m.liquidity.D1_2).toBe(100);
		expectNoNaN(m);
	});

	it('measures a clean rising series', () => {
		const m = build({
			asOf: asOf31,
			ledger: [tx({ tradeDate: days31[0] })],
			closes: new Map([['PETR4', rising(days31, 10000, 0.01)]]),
		});

		expect(m.performance.unavailable).toBeNull();
		expect(m.performance.observations).toBeGreaterThanOrEqual(20);
		expect(m.performance.twr).toBeCloseTo(
			1.01 ** m.performance.observations - 1,
			4
		);
		expect(m.performance.measuredFrom).toBe(days31[0]);
		expect(m.performance.measuredTo).toBe(asOf31);
		expect(m.performance.twrAnnualized).toBeNull();
		expect(m.risk.unavailable).toBeNull();
		expect(m.risk.maxDrawdown).toBe(0);
		expect(m.totalValueMinor).toBe(
			10 * rising(days31, 10000, 0.01)[30].closeMinor
		);
		// +34,8% em 42 dias corridos é ~1238% ao ano, fora do intervalo que
		// computeXirr procura (-99,9% a +1000% a.a.): a IRR sai null, não um
		// número absurdo. A IRR positiva é coberta no teste de benchmarks.
		expect(m.performance.mwr).toBeNull();
		expectNoNaN(m);
	});

	it('does not count a contribution as return', () => {
		const flat = rising(days31, 10000, 0);
		const m = build({
			asOf: asOf31,
			ledger: [
				tx({ tradeDate: days31[0] }),
				tx({ tradeDate: days31[15], quantity: 20 }),
			],
			closes: new Map([['PETR4', flat]]),
		});

		expect(m.performance.unavailable).toBeNull();
		expect(m.performance.twr).toBeCloseTo(0, 6);
		expect(m.risk.maxDrawdown).toBe(0);
		expect(m.totalValueMinor).toBe(30 * 10000);
	});

	it('measures a drop: drawdown dates and historical VaR', () => {
		const days = tradingDays('2025-05-05', 45);
		const up = rising(days.slice(0, 11), 10000, 0.01);
		const dropped = Math.round(up[10].closeMinor * 0.8);
		const closes = [
			...up,
			...days.slice(11).map((date) => ({ date, closeMinor: dropped })),
		];
		const m = build({
			asOf: days[44],
			ledger: [tx({ tradeDate: days[0] })],
			closes: new Map([['PETR4', closes]]),
		});

		expect(m.risk.unavailable).toBeNull();
		expect(m.risk.maxDrawdown).toBeCloseTo(-0.2, 4);
		expect(m.risk.drawdownPeakDate).toBe(days[10]);
		expect(m.risk.drawdownTroughDate).toBe(days[11]);
		expect(m.risk.volatilityAnnualized).toBeGreaterThan(0);
		expect(m.risk.var95).not.toBeNull();
		expect(m.risk.var95.pct).toBeGreaterThan(0);
		expect(m.risk.var95.horizonDays).toBe(21);
		expect(Number.isInteger(m.risk.var95.amountMinor)).toBe(true);
		expect(m.risk.var95.amountMinor).toBeGreaterThan(0);
	});

	it('keeps an unpriced asset at cost next to a priced one', () => {
		const m = build({
			asOf: asOf31,
			ledger: [
				tx({ tradeDate: days31[0] }),
				tx({
					tradeDate: days31[0],
					symbol: 'XPTO11',
					assetClass: AssetClass.Fund,
					quantity: 5,
					unitPriceMinor: 2000,
				}),
			],
			closes: new Map([['PETR4', rising(days31, 10000, 0.01)]]),
		});

		const xpto = m.positions.find((p) => p.symbol === 'XPTO11');
		expect(xpto.priced).toBe(false);
		expect(xpto.marketValueMinor).toBe(xpto.costMinor);
		expect(m.warnings.unpricedSymbols).toEqual(['XPTO11']);
		expect(m.performance.unavailable).toBeNull();
		expectNoNaN(m);
	});

	it('reports NO_PRICED_POSITIONS when nothing has a close', () => {
		const m = build({
			asOf: asOf31,
			ledger: [
				tx({
					tradeDate: days31[0],
					symbol: 'XPTO11',
					assetClass: AssetClass.Fund,
					quantity: 5,
					unitPriceMinor: 2000,
				}),
				tx({
					tradeDate: days31[1],
					symbol: 'CDB-X',
					assetClass: AssetClass.FixedIncome,
					quantity: 1,
					unitPriceMinor: 100000,
				}),
			],
		});

		expect(m.performance.unavailable).toBe('NO_PRICED_POSITIONS');
		expect(m.risk.unavailable).toBe('NO_PRICED_POSITIONS');
		expect(m.totalValueMinor).toBe(5 * 2000 + 100000);
		expect(m.warnings.unpricedSymbols).toEqual(['CDB-X', 'XPTO11']);
		expectNoNaN(m);
	});

	it('marks a mixed ledger as PARTIAL provenance', () => {
		const m = build({
			asOf: asOf31,
			ledger: [
				tx({ tradeDate: days31[0] }),
				tx({
					tradeDate: days31[0],
					symbol: 'VALE3',
					provenance: Provenance.Manual,
					source: TransactionSource.ManualEntry,
				}),
			],
		});

		expect(m.provenance).toBe(PortfolioProvenance.Partial);
	});

	it('lists CDI, IBOV and IPCA in order with excess over TWR', () => {
		const flat = rising(days31.slice(0, 25), 10000, 0);
		const closes = [
			...flat,
			...days31.slice(25).map((date) => ({ date, closeMinor: 10300 })),
		];
		const m = build({
			asOf: asOf31,
			ledger: [tx({ tradeDate: days31[0] })],
			closes: new Map([['PETR4', closes]]),
			benchmarkReturns: { CDI: 0.01, IBOV: null },
		});

		expect(m.performance.twr).toBeCloseTo(0.03, 6);
		expect(m.benchmarks.map((b) => b.key)).toEqual(['CDI', 'IBOV', 'IPCA']);
		expect(m.benchmarks[0].periodReturn).toBe(0.01);
		expect(m.benchmarks[0].excess).toBeCloseTo(0.02, 6);
		expect(m.benchmarks[1]).toEqual({
			key: 'IBOV',
			periodReturn: null,
			excess: null,
		});
		expect(m.benchmarks[2]).toEqual({
			key: 'IPCA',
			periodReturn: null,
			excess: null,
		});
		expect(m.performance.mwr).toBeGreaterThan(0);
	});

	it('fills drift only when a target is given', () => {
		const input = {
			asOf: asOf31,
			ledger: [tx({ tradeDate: days31[0] })],
			closes: new Map([['PETR4', rising(days31, 10000, 0.01)]]),
		};

		const withTarget = build({
			...input,
			target: { [AssetClass.Stock]: 60, [AssetClass.FixedIncome]: 40 },
		});
		expect(withTarget.allocation.target).toEqual({
			STOCK: 60,
			FIXED_INCOME: 40,
		});
		expect(withTarget.allocation.driftPp.STOCK).toBe(40);
		expect(withTarget.allocation.driftPp.FIXED_INCOME).toBe(-40);

		const without = build({ ...input, target: null });
		expect(without.allocation.target).toBeNull();
		expect(without.allocation.driftPp).toBeNull();
		expect(without.allocation.current.STOCK).toBe(100);
	});

	it('does not throw on an inconsistent ledger and reports it', () => {
		const m = build({
			asOf: asOf31,
			ledger: [
				tx({ tradeDate: days31[0] }),
				tx({
					tradeDate: days31[2],
					symbol: 'VALE3',
					side: TransactionSide.Sell,
					quantity: 3,
				}),
			],
			closes: new Map([['PETR4', rising(days31, 10000, 0.01)]]),
		});

		expect(m.warnings.ledgerInconsistencies).toEqual([`VALE3@${days31[2]}`]);
		expect(m.positions.map((p) => p.symbol)).toEqual(['PETR4']);
		expectSeriesRefused(m);
		expectNoNaN(m);
	});

	it('refuses the series when a sale exceeds the holding', () => {
		const m = build({
			asOf: asOf31,
			ledger: [
				tx({ tradeDate: days31[0] }),
				tx({ tradeDate: days31[1], symbol: 'VALE3' }),
				tx({
					tradeDate: days31[5],
					symbol: 'VALE3',
					side: TransactionSide.Sell,
					quantity: 15,
				}),
			],
			closes: new Map([
				['PETR4', rising(days31, 10000, 0.01)],
				['VALE3', rising(days31, 10000, 0.01)],
			]),
			benchmarkReturns: {},
		});

		expect(m.warnings.ledgerInconsistencies).toEqual([`VALE3@${days31[5]}`]);
		expect(m.positions.map((p) => p.symbol)).toEqual(['PETR4']);
		expectSeriesRefused(m);
		expect(
			measuredWindow({
				asOf: asOf31,
				ledger: [
					tx({ tradeDate: days31[0] }),
					tx({
						tradeDate: days31[5],
						side: TransactionSide.Sell,
						quantity: 15,
					}),
				],
				closes: new Map([['PETR4', rising(days31, 10000, 0.01)]]),
			})
		).toBeNull();
		expectNoNaN(m);
	});

	it('replays a same-day sell-before-buy in ledger order', () => {
		const closes = new Map([
			['PETR4', rising(days31, 10000, 0.01)],
			['VALE3', rising(days31, 5000, 0.02)],
		]);
		const base = [tx({ tradeDate: days31[0] })];
		const dayTrade = days31[10];
		const sell = tx({
			tradeDate: dayTrade,
			symbol: 'VALE3',
			side: TransactionSide.Sell,
			unitPriceMinor: 6000,
		});
		const buy = tx({
			tradeDate: dayTrade,
			symbol: 'VALE3',
			unitPriceMinor: 6000,
		});
		expect(sell.createdAt.getTime()).toBeLessThan(buy.createdAt.getTime());

		const withTrade = build({
			asOf: asOf31,
			ledger: [...base, sell, buy],
			closes,
		});
		const without = build({ asOf: asOf31, ledger: base, closes });

		expect(withTrade.warnings.ledgerInconsistencies).toEqual([]);
		expect(withTrade.positions.map((p) => p.symbol)).toEqual(['PETR4']);
		expect(withTrade.performance.unavailable).toBeNull();
		expect(withTrade.performance.twr).toBeCloseTo(without.performance.twr, 4);
	});

	it('never words anything as a recommendation', () => {
		const m = build({
			asOf: asOf31,
			ledger: [tx({ tradeDate: days31[0] })],
			closes: new Map([['PETR4', rising(days31, 10000, 0.01)]]),
			target: { [AssetClass.Stock]: 50, [AssetClass.Fund]: 50 },
			benchmarkReturns: { CDI: 0.01, IBOV: 0.02, IPCA: 0.005 },
		});

		expect(JSON.stringify(m)).not.toMatch(
			/recomend|sugest|deveria|comprar|vender|aportar/i
		);
	});
});

describe('measuredWindow', () => {
	it('is the TWR window when performance is measurable', () => {
		const days = tradingDays('2025-05-05', 31);
		const ledger = [tx({ tradeDate: days[0] })];
		const closes = new Map([['PETR4', rising(days, 10000, 0.01)]]);
		const asOf = days[30];

		expect(measuredWindow({ asOf, ledger, closes })).toEqual({
			from: days[0],
			to: days[30],
		});
	});

	it('is null when performance is unavailable', () => {
		const days = tradingDays('2025-05-05', 10);
		expect(
			measuredWindow({
				asOf: days[9],
				ledger: [tx({ tradeDate: days[0] })],
				closes: new Map([['PETR4', rising(days, 10000, 0.01)]]),
			})
		).toBeNull();
		expect(
			measuredWindow({ asOf: days[9], ledger: [], closes: new Map() })
		).toBeNull();
	});
});
