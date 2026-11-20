import {
	AssetClass,
	Provenance,
	TransactionSide,
	TransactionSource,
} from '../domain/enums';
import { buildPortfolioMetrics } from './metrics/build-portfolio-metrics';
import type {
	SharedHolding,
	SharedPortfolioData,
	SharedTrade,
} from './ports/shared-portfolio-source.port';
import { reconcileSharedPortfolio } from './shared-portfolio.mapper';

const IDS = { orgId: 'orgA', clientProfileId: 'client-1' };

let seq = 0;
const trade = (over: Partial<SharedTrade> = {}): SharedTrade => {
	seq += 1;
	return {
		symbol: 'PETR4',
		assetClass: AssetClass.Stock,
		side: TransactionSide.Buy,
		quantity: 10,
		unitPriceMinor: 3000,
		feesMinor: 0,
		tradeDate: '2025-05-05',
		provenance: Provenance.Verified,
		createdAt: new Date(2025, 0, 1, 0, 0, seq),
		...over,
	};
};

/** Custo como o adaptador calcula: round(quantidade × custo unitário × 100). */
const holding = (
	over: Partial<SharedHolding> & { unitCost?: number } = {}
): SharedHolding => {
	const { unitCost = 30, ...rest } = over;
	const quantity = rest.quantity ?? 10;
	return {
		symbol: 'PETR4',
		assetClass: AssetClass.Stock,
		quantity,
		costMinor: Math.round(quantity * unitCost * 100),
		provenance: Provenance.Verified,
		...rest,
	};
};

const portfolio = (
	holdings: SharedHolding[],
	trades: SharedTrade[]
): SharedPortfolioData => ({
	portfolioId: 'p1',
	name: 'Principal',
	holdings,
	trades,
});

describe('reconcileSharedPortfolio', () => {
	it('puts matching trades in the ledger with their seal', () => {
		const trades = [
			trade({ quantity: 6 }),
			trade({
				quantity: 4,
				tradeDate: '2025-05-06',
				provenance: Provenance.Manual,
			}),
		];

		const r = reconcileSharedPortfolio(portfolio([holding()], trades), IDS);

		expect(r.holdingsWithoutHistory).toEqual([]);
		expect(r.unreconciledSymbols).toEqual([]);
		expect(r.ledger).toEqual([
			{
				id: 'p1:0',
				orgId: 'orgA',
				clientProfileId: 'client-1',
				symbol: 'PETR4',
				assetClass: AssetClass.Stock,
				side: TransactionSide.Buy,
				quantity: 6,
				unitPriceMinor: 3000,
				feesMinor: 0,
				currency: 'BRL',
				tradeDate: '2025-05-05',
				provenance: Provenance.Verified,
				source: TransactionSource.CsvImport,
				createdByUserId: '',
				createdAt: trades[0].createdAt,
			},
			expect.objectContaining({
				id: 'p1:1',
				quantity: 4,
				provenance: Provenance.Manual,
				source: TransactionSource.ManualEntry,
			}),
		]);
	});

	it('keeps a holding without trades at its own quantity and cost', () => {
		const cdb = holding({
			symbol: 'CDB-X',
			assetClass: AssetClass.FixedIncome,
			quantity: 3,
			unitCost: 1000.555,
			provenance: Provenance.Manual,
		});

		const r = reconcileSharedPortfolio(portfolio([cdb], []), IDS);

		expect(r.ledger).toEqual([]);
		expect(r.unreconciledSymbols).toEqual([]);
		expect(r.holdingsWithoutHistory).toEqual([
			{
				symbol: 'CDB-X',
				assetClass: AssetClass.FixedIncome,
				quantity: 3,
				costMinor: Math.round(3 * 1000.555 * 100),
				provenance: Provenance.Manual,
			},
		]);
	});

	it('drops the trades of a holding they do not explain', () => {
		const r = reconcileSharedPortfolio(
			portfolio(
				[holding({ quantity: 100 }), holding({ symbol: 'VALE3' })],
				[
					trade({ quantity: 40 }),
					trade({ quantity: 20 }),
					trade({ symbol: 'VALE3' }),
				]
			),
			IDS
		);

		expect(r.holdingsWithoutHistory).toEqual([
			expect.objectContaining({
				symbol: 'PETR4',
				quantity: 100,
				costMinor: 300000,
			}),
		]);
		expect(r.ledger.map((t) => t.symbol)).toEqual(['VALE3']);
		expect(r.ledger.map((t) => t.id)).toEqual(['p1:2']);
	});

	it('keeps the history of a symbol sold in full', () => {
		const r = reconcileSharedPortfolio(
			portfolio(
				[],
				[
					trade(),
					trade({
						side: TransactionSide.Sell,
						tradeDate: '2025-05-20',
						unitPriceMinor: 3500,
					}),
				]
			),
			IDS
		);

		expect(r.ledger).toHaveLength(2);
		expect(r.holdingsWithoutHistory).toEqual([]);
		expect(r.unreconciledSymbols).toEqual([]);
	});

	it('leaves out an open position with no holding behind it', () => {
		const r = reconcileSharedPortfolio(
			portfolio(
				[holding({ symbol: 'VALE3' })],
				[
					trade({ quantity: 30 }),
					trade({ side: TransactionSide.Sell, quantity: 20 }),
					trade({ symbol: 'VALE3' }),
				]
			),
			IDS
		);

		expect(r.unreconciledSymbols).toEqual(['PETR4']);
		expect(r.ledger.map((t) => t.symbol)).toEqual(['VALE3']);
		expect(r.holdingsWithoutHistory).toEqual([]);
	});

	it('does not let an oversold history reach the builder', () => {
		const r = reconcileSharedPortfolio(
			portfolio(
				[holding(), holding({ symbol: 'VALE3' })],
				[
					trade({ side: TransactionSide.Sell, quantity: 5 }),
					trade({ quantity: 10, tradeDate: '2025-05-06' }),
					trade({ symbol: 'VALE3' }),
				]
			),
			IDS
		);

		expect(r.holdingsWithoutHistory).toEqual([
			expect.objectContaining({ symbol: 'PETR4', quantity: 10 }),
		]);
		expect(r.ledger.map((t) => t.symbol)).toEqual(['VALE3']);
		const m = buildPortfolioMetrics({
			asOf: '2025-06-30',
			ledger: r.ledger,
			closes: new Map(),
			target: null,
			benchmarkReturns: {},
			holdingsWithoutHistory: r.holdingsWithoutHistory,
		});
		expect(m.warnings.ledgerInconsistencies).toEqual([]);
		expect(m.performance.unavailable).not.toBe('INCONSISTENT_LEDGER');
	});

	it('leaves out an oversold history with no holding', () => {
		const r = reconcileSharedPortfolio(
			portfolio([], [trade({ side: TransactionSide.Sell, quantity: 5 })]),
			IDS
		);

		expect(r.ledger).toEqual([]);
		expect(r.unreconciledSymbols).toEqual(['PETR4']);
	});

	it('matches despite floating point rounding', () => {
		const r = reconcileSharedPortfolio(
			portfolio(
				[
					holding({
						quantity: 0.3,
						symbol: 'BTC',
						assetClass: AssetClass.Crypto,
					}),
				],
				[
					trade({
						symbol: 'BTC',
						assetClass: AssetClass.Crypto,
						quantity: 0.1,
					}),
					trade({
						symbol: 'BTC',
						assetClass: AssetClass.Crypto,
						quantity: 0.2,
					}),
				]
			),
			IDS
		);

		expect(0.1 + 0.2).not.toBe(0.3);
		expect(r.ledger).toHaveLength(2);
		expect(r.holdingsWithoutHistory).toEqual([]);
	});

	it('treats a trade with a non-finite number as no history', () => {
		const r = reconcileSharedPortfolio(
			portfolio(
				[holding()],
				[trade({ quantity: 5 }), trade({ quantity: 5, unitPriceMinor: NaN })]
			),
			IDS
		);

		expect(r.ledger).toEqual([]);
		expect(r.holdingsWithoutHistory).toEqual([
			expect.objectContaining({ symbol: 'PETR4', quantity: 10 }),
		]);
	});

	it('adds up two holdings of the same symbol', () => {
		const r = reconcileSharedPortfolio(
			portfolio(
				[
					holding({ quantity: 4 }),
					holding({ quantity: 6, provenance: Provenance.Manual }),
				],
				[]
			),
			IDS
		);

		expect(r.holdingsWithoutHistory).toEqual([
			{
				symbol: 'PETR4',
				assetClass: AssetClass.Stock,
				quantity: 10,
				costMinor: 30000,
				provenance: Provenance.Manual,
			},
		]);
	});
});
