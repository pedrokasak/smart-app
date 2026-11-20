import { PortfolioSharingReadService } from 'src/portfolio/sharing/portfolio-sharing-read.service';
import {
	SharedHoldingDto,
	SharedPortfolioDto,
	SharedTradeDto,
} from 'src/portfolio/sharing/shared-portfolio.dto';
import { AssetClass, Provenance, TransactionSide } from '../domain/enums';
import { B2cSharedPortfolioSourceAdapter } from './b2c-shared-portfolio-source.adapter';

const holding = (over: Partial<SharedHoldingDto> = {}): SharedHoldingDto => ({
	symbol: 'PETR4',
	type: 'stock',
	quantity: 10,
	unitCost: 12.34,
	source: 'manual',
	...over,
});

const trade = (over: Partial<SharedTradeDto> = {}): SharedTradeDto => ({
	symbol: 'PETR4',
	side: 'buy',
	quantity: 10,
	price: 12.34,
	fees: 0.5,
	date: '2030-01-02',
	imported: false,
	createdAt: new Date('2030-01-03T00:00:00Z'),
	...over,
});

const portfolio = (
	holdings: SharedHoldingDto[] = [],
	trades: SharedTradeDto[] = []
): SharedPortfolioDto => ({ id: 'p1', name: 'Carteira', holdings, trades });

function build(result: SharedPortfolioDto[] = []) {
	const reader = {
		listOwned: jest.fn().mockResolvedValue([{ id: 'p1', name: 'Carteira' }]),
		readOwned: jest.fn().mockResolvedValue(result),
	};
	const adapter = new B2cSharedPortfolioSourceAdapter(
		reader as unknown as PortfolioSharingReadService
	);
	return { adapter, reader };
}

describe('B2cSharedPortfolioSourceAdapter', () => {
	it('lists owned portfolios as they come', async () => {
		const { adapter, reader } = build();

		expect(await adapter.listOwned('u1')).toEqual([
			{ id: 'p1', name: 'Carteira' },
		]);
		expect(reader.listOwned).toHaveBeenCalledWith('u1');
	});

	it('passes the user and the ids to the B2C reader untouched', async () => {
		const { adapter, reader } = build();

		await adapter.read('u1', ['p1', 'p2']);

		expect(reader.readOwned).toHaveBeenCalledWith('u1', ['p1', 'p2']);
	});

	it.each([
		['stock', AssetClass.Stock],
		['fii', AssetClass.Fii],
		['etf', AssetClass.Etf],
		['crypto', AssetClass.Crypto],
		['fund', AssetClass.Fund],
		['investment_fund', AssetClass.Fund],
		['fixed_income', AssetClass.FixedIncome],
		['anything-else', AssetClass.Other],
	])('maps asset type %s to %s', async (type, expected) => {
		const { adapter } = build([portfolio([holding({ type })])]);

		const [data] = await adapter.read('u1', ['p1']);

		expect(data.holdings[0].assetClass).toBe(expected);
	});

	it('maps holdings: total cost in cents (quantity x unit cost), source to provenance', async () => {
		const { adapter } = build([
			portfolio([
				holding({ symbol: 'A', source: 'b3', unitCost: 12.34 }),
				holding({ symbol: 'B', source: 'manual' }),
				holding({ symbol: 'C', source: 'webscrape' }),
			]),
		]);

		const [data] = await adapter.read('u1', ['p1']);

		expect(data.portfolioId).toBe('p1');
		expect(data.name).toBe('Carteira');
		expect(data.holdings[0]).toEqual({
			symbol: 'A',
			assetClass: AssetClass.Stock,
			quantity: 10,
			costMinor: 12340,
			provenance: Provenance.Verified,
		});
		expect(data.holdings[1].provenance).toBe(Provenance.Manual);
		expect(data.holdings[2].provenance).toBe(Provenance.Manual);
	});

	it('maps trades: imported is VERIFIED, side and cents are converted', async () => {
		const { adapter } = build([
			portfolio(
				[],
				[
					trade({ imported: true, side: 'sell', price: 0.29, fees: 1.5 }),
					trade({ imported: false }),
				]
			),
		]);

		const [data] = await adapter.read('u1', ['p1']);

		expect(data.trades[0]).toEqual({
			symbol: 'PETR4',
			assetClass: AssetClass.Other,
			side: TransactionSide.Sell,
			quantity: 10,
			unitPriceMinor: 29,
			feesMinor: 150,
			tradeDate: '2030-01-02',
			provenance: Provenance.Verified,
			createdAt: new Date('2030-01-03T00:00:00Z'),
		});
		expect(data.trades[1].provenance).toBe(Provenance.Manual);
		expect(data.trades[1].side).toBe(TransactionSide.Buy);
	});

	it('classifies a trade by the holding of the same symbol', async () => {
		const { adapter } = build([
			portfolio(
				[holding({ symbol: 'HGLG11', type: 'fii' })],
				[trade({ symbol: 'HGLG11' }), trade({ symbol: 'UNKNOWN' })]
			),
		]);

		const [data] = await adapter.read('u1', ['p1']);

		expect(data.trades[0].assetClass).toBe(AssetClass.Fii);
		expect(data.trades[1].assetClass).toBe(AssetClass.Other);
	});

	describe('holding guard', () => {
		it.each([
			['quantity 0', { quantity: 0 }],
			['quantity NaN', { quantity: NaN }],
			['quantity Infinity', { quantity: Infinity }],
			['negative quantity', { quantity: -1 }],
			['unit cost NaN', { unitCost: NaN }],
			['unit cost undefined', { unitCost: undefined as unknown as number }],
			['unit cost 0', { unitCost: 0 }],
			['negative unit cost', { unitCost: -3 }],
			['unit cost Infinity', { unitCost: Infinity }],
		])('drops a holding with %s', async (_label, over) => {
			const { adapter } = build([
				portfolio([holding({ symbol: 'BAD', ...over }), holding()]),
			]);

			const [data] = await adapter.read('u1', ['p1']);

			expect(data.holdings.map((h) => h.symbol)).toEqual(['PETR4']);
		});

		it('drops a holding whose cost rounds to zero cents', async () => {
			const { adapter } = build([
				portfolio([holding({ quantity: 1, unitCost: 0.001 })]),
			]);

			const [data] = await adapter.read('u1', ['p1']);

			expect(data.holdings).toEqual([]);
		});
	});

	describe('trade guard', () => {
		it.each([
			['quantity 0', { quantity: 0 }],
			['quantity NaN', { quantity: NaN }],
			['negative quantity', { quantity: -2 }],
			['price NaN', { price: NaN }],
			['price 0', { price: 0 }],
			['negative price', { price: -1 }],
			['price Infinity', { price: Infinity }],
			['invalid date', { date: 'not-a-date' }],
			['impossible date', { date: '2030-02-31' }],
			['empty date', { date: '' }],
		])('drops a trade with %s', async (_label, over) => {
			const { adapter } = build([
				portfolio([], [trade({ symbol: 'BAD', ...over }), trade()]),
			]);

			const [data] = await adapter.read('u1', ['p1']);

			expect(data.trades.map((t) => t.symbol)).toEqual(['PETR4']);
		});

		it('keeps a trade with zero or missing fees as zero cents', async () => {
			const { adapter } = build([
				portfolio(
					[],
					[
						trade({ fees: 0 }),
						trade({ fees: undefined as unknown as number }),
						trade({ fees: NaN }),
					]
				),
			]);

			const [data] = await adapter.read('u1', ['p1']);

			expect(data.trades.map((t) => t.feesMinor)).toEqual([0, 0, 0]);
		});
	});
});

describe('B2cSharedPortfolioSourceAdapter cost', () => {
	it('turns 12.34 of unit cost into 1234 cents for one unit', async () => {
		const reader = {
			listOwned: jest.fn(),
			readOwned: jest
				.fn()
				.mockResolvedValue([
					portfolio([holding({ quantity: 1, unitCost: 12.34 })]),
				]),
		};
		const adapter = new B2cSharedPortfolioSourceAdapter(
			reader as unknown as PortfolioSharingReadService
		);

		const [data] = await adapter.read('u1', ['p1']);

		expect(data.holdings[0].costMinor).toBe(1234);
	});
});
