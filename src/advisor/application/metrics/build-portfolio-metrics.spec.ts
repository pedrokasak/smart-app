import {
	AssetClass,
	PortfolioProvenance,
	Provenance,
	TransactionSide,
	TransactionSource,
} from '../../domain/enums';
import { Position, Transaction } from '../../domain/portfolio.entities';
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
		mwrAnnualized: null,
		measuredFrom: null,
		measuredTo: null,
		observations: 0,
		coveragePct: 100,
		unavailable: 'INCONSISTENT_LEDGER',
	});
	expect(m.risk).toEqual({
		volatilityAnnualized: null,
		maxDrawdown: null,
		currentDrawdown: null,
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

		expect(m.performance.coveragePct).toBe(0);
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
		expect(m.performance.mwrAnnualized).toBeNull();
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
		expect(m.performance.mwrAnnualized).toBeNull();
		expect(m.performance.coveragePct).toBe(100);
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
		expect(m.performance.twr).toBeCloseTo(
			1.01 ** m.performance.observations - 1,
			4
		);
		expectNoNaN(m);
	});

	describe('an unpriced position does not dilute return and risk', () => {
		const days = tradingDays('2025-05-05', 60);
		const asOf = days[59];
		// Sobe em zigue-zague e depois cai: volatilidade e VaR de 21 dias > 0.
		let level = 10000;
		const closes = days.map((date, i) => {
			if (i > 0) {
				const up = i % 2 === 1;
				level *= i <= 30 ? (up ? 1.03 : 0.99) : up ? 1.005 : 0.98;
			}
			return { date, closeMinor: Math.round(level) };
		});
		const priced = [tx({ tradeDate: days[0] })];
		const pricedValueMinor = 10 * closes[59].closeMinor;
		const unpriced = tx({
			tradeDate: days[0],
			symbol: 'CDB-X',
			assetClass: AssetClass.FixedIncome,
			quantity: 1,
			unitPriceMinor: 9 * pricedValueMinor,
		});
		const alone = build({
			asOf,
			ledger: priced,
			closes: new Map([['PETR4', closes]]),
		});
		const mixed = build({
			asOf,
			ledger: [...priced, unpriced],
			closes: new Map([['PETR4', closes]]),
		});

		it('keeps twr and volatility of the priced series', () => {
			expect(alone.performance.unavailable).toBeNull();
			expect(mixed.performance.unavailable).toBeNull();
			expect(mixed.performance.twr).toBeCloseTo(alone.performance.twr, 6);
			expect(mixed.risk.volatilityAnnualized).toBeCloseTo(
				alone.risk.volatilityAnnualized,
				6
			);
			expect(mixed.risk.volatilityAnnualized).toBeGreaterThan(0);
		});

		it('applies VaR to the priced market value only', () => {
			expect(mixed.risk.var95).not.toBeNull();
			expect(mixed.risk.var95.amountMinor).toBeGreaterThan(0);
			expect(mixed.risk.var95).toEqual(alone.risk.var95);
			expect(mixed.risk.var95.amountMinor).toBe(
				Math.round(pricedValueMinor * mixed.risk.var95.pct)
			);
		});

		it('reports the priced share of market value as coveragePct', () => {
			expect(mixed.totalValueMinor).toBe(10 * pricedValueMinor);
			expect(mixed.performance.coveragePct).toBeCloseTo(10, 4);
			expect(alone.performance.coveragePct).toBe(100);
		});

		it('keeps the unpriced position at cost in the snapshot', () => {
			const cdb = mixed.positions.find((p) => p.symbol === 'CDB-X');
			expect(cdb.priced).toBe(false);
			expect(cdb.marketValueMinor).toBe(9 * pricedValueMinor);
			expect(mixed.allocation.current.FIXED_INCOME).toBeCloseTo(90, 4);
		});
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
		expect(m.performance.coveragePct).toBe(0);
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
		// Janela curta: a MWR é a do período, sem anualizar.
		expect(m.performance.mwr).toBeGreaterThan(0);
		expect(m.performance.mwr).toBeLessThan(0.05);
		expect(m.performance.mwrAnnualized).toBeNull();
	});

	it('annualizes the MWR only over 365 days or more', () => {
		const days = tradingDays('2024-05-06', 260);
		const asOf = days[259];
		const calendarDays = Math.round(
			(Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${days[0]}T00:00:00Z`)) /
				86_400_000
		);
		expect(calendarDays).toBeGreaterThanOrEqual(365);

		const m = build({
			asOf,
			ledger: [tx({ tradeDate: days[0] })],
			closes: new Map([['PETR4', rising(days, 10000, 0.0005)]]),
		});

		expect(m.performance.mwrAnnualized).not.toBeNull();
		expect(m.performance.mwrAnnualized).toBeGreaterThan(0);
		expect(m.performance.mwr).toBeCloseTo(
			(1 + m.performance.mwrAnnualized) ** (calendarDays / 365) - 1,
			6
		);
		expect(m.performance.mwr).toBeCloseTo(1.0005 ** 259 - 1, 3);
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

describe('buildPortfolioMetrics short-term change and current drawdown', () => {
	const closesOf = (days: string[], values: number[]): DailyCloseMinor[] =>
		days.map((date, i) => ({ date, closeMinor: values[i] }));

	it('reports the 5-session change with sign and the last close date', () => {
		const days = tradingDays('2025-05-05', 6);
		const m = build({
			asOf: days[5],
			ledger: [tx({ tradeDate: days[0] })],
			closes: new Map([
				['PETR4', closesOf(days, [10000, 9900, 9800, 9500, 9000, 8800])],
			]),
		});

		expect(m.positions[0].change5dPct).toBe(-12);
		expect(m.positions[0].lastCloseDate).toBe(days[5]);
	});

	it('is null with fewer than 6 closes, but keeps the last close date', () => {
		const days = tradingDays('2025-05-05', 5);
		const m = build({
			asOf: days[4],
			ledger: [tx({ tradeDate: days[0] })],
			closes: new Map([
				['PETR4', closesOf(days, [10000, 9900, 9800, 9500, 9000])],
			]),
		});

		expect(m.positions[0].change5dPct).toBeNull();
		expect(m.positions[0].lastCloseDate).toBe(days[4]);
	});

	it('ignores closes after asOf', () => {
		const days = tradingDays('2025-05-05', 7);
		const m = build({
			asOf: days[5],
			ledger: [tx({ tradeDate: days[0] })],
			closes: new Map([
				['PETR4', closesOf(days, [10000, 9900, 9800, 9500, 9000, 8800, 5000])],
			]),
		});

		expect(m.positions[0].change5dPct).toBe(-12);
		expect(m.positions[0].lastCloseDate).toBe(days[5]);
	});

	it('is null on both fields for a position without a quote', () => {
		const m = build({
			asOf: '2025-06-30',
			ledger: [tx({ tradeDate: '2025-05-05' })],
		});

		expect(m.positions[0].priced).toBe(false);
		expect(m.positions[0].change5dPct).toBeNull();
		expect(m.positions[0].lastCloseDate).toBeNull();
	});

	it('is 0 after a drop older than 252 sessions that has recovered', () => {
		const days = tradingDays('2024-01-02', 330);
		const values = days.map((_, i) => {
			if (i < 20) return 10000;
			if (i < 70) return 8000;
			if (i < 100) return 8000 + Math.round(((i - 69) / 30) * 2000);
			return 10000;
		});
		const m = build({
			asOf: days[329],
			ledger: [tx({ tradeDate: days[0] })],
			closes: new Map([['PETR4', closesOf(days, values)]]),
		});

		expect(m.risk.unavailable).toBeNull();
		expect(m.risk.maxDrawdown).toBeCloseTo(-0.2, 4);
		expect(m.risk.currentDrawdown).toBe(0);
	});

	it('is the fall from the last peak: 100 -> 110 -> 99 gives 0.1', () => {
		const days = tradingDays('2025-05-05', 40);
		const values = days.map((_, i) =>
			i < 38 ? 10000 : i === 38 ? 11000 : 9900
		);
		const m = build({
			asOf: days[39],
			ledger: [tx({ tradeDate: days[0] })],
			closes: new Map([['PETR4', closesOf(days, values)]]),
		});

		expect(m.risk.currentDrawdown).toBeCloseTo(0.1, 6);
	});

	it('is null whenever risk is unavailable', () => {
		const m = build({ asOf: '2025-06-30', ledger: [] });

		expect(m.risk.unavailable).not.toBeNull();
		expect(m.risk.currentDrawdown).toBeNull();
	});
});

describe('buildPortfolioMetrics with holdings without history', () => {
	const days = tradingDays('2025-05-05', 60);
	const asOf = days[59];
	let level = 10000;
	const petrCloses = days.map((date, i) => {
		if (i > 0) {
			const up = i % 2 === 1;
			level *= i <= 30 ? (up ? 1.03 : 0.99) : up ? 1.005 : 0.98;
		}
		return { date, closeMinor: Math.round(level) };
	});
	const valeCloses = rising(days, 6000, 0.001);
	const ledger = [tx({ tradeDate: days[0] })];
	const vale: Position = {
		symbol: 'VALE3',
		assetClass: AssetClass.Stock,
		quantity: 20,
		costMinor: 100000,
		provenance: Provenance.Manual,
	};
	const closes = new Map([
		['PETR4', petrCloses],
		['VALE3', valeCloses],
	]);
	const input = {
		asOf,
		ledger,
		closes,
		target: null,
		benchmarkReturns: { CDI: 0.01 },
	};

	it('values them in the snapshot but keeps them out of the series', () => {
		const alone = buildPortfolioMetrics(input);
		const m = buildPortfolioMetrics({
			...input,
			holdingsWithoutHistory: [vale],
		});

		const petrValue = 10 * petrCloses[59].closeMinor;
		const valeValue = 20 * valeCloses[59].closeMinor;
		const valued = m.positions.find((p) => p.symbol === 'VALE3');
		expect(valued.priced).toBe(true);
		expect(valued.marketValueMinor).toBe(valeValue);
		expect(m.totalValueMinor).toBe(petrValue + valeValue);
		expect(m.provenance).toBe(PortfolioProvenance.Partial);
		expect(m.concentration.top.map((t) => t.symbol).sort()).toEqual([
			'PETR4',
			'VALE3',
		]);

		expect(alone.performance.unavailable).toBeNull();
		expect(m.performance.twr).toBeCloseTo(alone.performance.twr, 6);
		expect(m.performance.mwr).toEqual(alone.performance.mwr);
		expect(m.performance.observations).toBe(alone.performance.observations);
		expect(m.risk.volatilityAnnualized).toBeCloseTo(
			alone.risk.volatilityAnnualized,
			6
		);
		expect(m.risk.var95).toEqual(alone.risk.var95);
		expect(m.performance.coveragePct).toBeCloseTo(
			(petrValue / (petrValue + valeValue)) * 100,
			4
		);
		expect(m.warnings.noHistorySymbols).toEqual(['VALE3']);
		expect(m.warnings.unpricedSymbols).toEqual([]);
		expectNoNaN(m);
	});

	it('keeps an unpriced holding at cost and lists it as unpriced', () => {
		const m = buildPortfolioMetrics({
			...input,
			holdingsWithoutHistory: [
				{ ...vale, symbol: 'CDB-X', assetClass: AssetClass.FixedIncome },
			],
		});

		const cdb = m.positions.find((p) => p.symbol === 'CDB-X');
		expect(cdb.priced).toBe(false);
		expect(cdb.marketValueMinor).toBe(100000);
		expect(m.warnings.unpricedSymbols).toEqual(['CDB-X']);
		expect(m.warnings.noHistorySymbols).toEqual(['CDB-X']);
	});

	it('fills the snapshot from holdings alone, with no performance', () => {
		const m = buildPortfolioMetrics({
			...input,
			ledger: [],
			holdingsWithoutHistory: [vale],
		});

		expect(m.positions.map((p) => p.symbol)).toEqual(['VALE3']);
		expect(m.totalValueMinor).toBe(20 * valeCloses[59].closeMinor);
		expect(m.provenance).toBe(PortfolioProvenance.Manual);
		expect(m.concentration.hhi).toBe(1);
		expect(m.liquidity.D1_2).toBe(100);
		expect(m.allocation.current.STOCK).toBe(100);
		expect(m.performance.unavailable).toBe('NO_TRANSACTIONS');
		expect(m.performance.coveragePct).toBe(0);
		expect(m.performance.twr).toBeNull();
		expect(m.performance.mwr).toBeNull();
		expect(m.risk.var95).toBeNull();
		expect(m.benchmarks.every((b) => b.excess === null)).toBe(true);
		expect(m.warnings.noHistorySymbols).toEqual(['VALE3']);
		expectNoNaN(m);
	});

	it('lets the ledger win when a symbol is in both', () => {
		const m = buildPortfolioMetrics({
			...input,
			holdingsWithoutHistory: [
				{ ...vale, symbol: 'PETR4', quantity: 999 },
				vale,
			],
		});

		const petr = m.positions.filter((p) => p.symbol === 'PETR4');
		expect(petr).toHaveLength(1);
		expect(petr[0].quantity).toBe(10);
		expect(m.warnings.noHistorySymbols).toEqual(['VALE3']);
	});

	it('lists the no-history symbols in alphabetical order', () => {
		const m = buildPortfolioMetrics({
			...input,
			holdingsWithoutHistory: [
				{ ...vale, symbol: 'WEGE3' },
				{ ...vale, symbol: 'ITUB4' },
			],
		});

		expect(m.warnings.noHistorySymbols).toEqual(['ITUB4', 'WEGE3']);
	});

	it('gives the same result without the parameter and with []', () => {
		const without = buildPortfolioMetrics(input);
		const empty = buildPortfolioMetrics({
			...input,
			holdingsWithoutHistory: [],
		});

		expect(empty).toEqual(without);
		expect(without.warnings.noHistorySymbols).toEqual([]);
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
