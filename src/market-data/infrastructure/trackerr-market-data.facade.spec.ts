import { TrackerrMarketDataFacade } from 'src/market-data/infrastructure/trackerr-market-data.facade';
import { FundamentusFallbackAdapter } from 'src/stocks/adapter/fundamentus-fallback.adapter';
import { StockService } from 'src/stocks/stocks.service';

describe('TrackerrMarketDataFacade', () => {
	it('returns primary provider data when available', async () => {
		const stockService = {
			getNationalQuote: jest.fn().mockResolvedValue({
				results: [
					{
						symbol: 'PETR4',
						sector: 'Energy',
						regularMarketPrice: 30,
						dividendYield: 0.1,
						regularMarketChangePercent: 1.5,
						priceEarnings: 4,
						priceToBook: 1,
						returnOnEquity: 0.2,
						netMargin: 0.1,
						enterpriseValueEbitda: 3,
						marketCap: 100,
					},
				],
			}),
			getStockQuoteGlobal: jest.fn(),
		} as unknown as StockService;
		const fundamentus = {
			getSnapshot: jest.fn(),
		} as unknown as FundamentusFallbackAdapter;

		const facade = new TrackerrMarketDataFacade(stockService, fundamentus);
		const result = await facade.getAssetSnapshot('PETR4');

		expect(result?.symbol).toBe('PETR4');
		expect(result?.metadata.source).toBe('primary');
		expect(fundamentus.getSnapshot).not.toHaveBeenCalled();
	});

	it('uses fundamentus fallback when providers fail', async () => {
		const stockService = {
			getNationalQuote: jest.fn().mockRejectedValue(new Error('primary down')),
			getStockQuoteGlobal: jest
				.fn()
				.mockRejectedValue(new Error('global down')),
		} as unknown as StockService;
		const fundamentus = {
			getSnapshot: jest.fn().mockResolvedValue({
				numeric: {
					COTACAO: 12,
					'P/L': 6,
					'P/VP': 1,
					'DIV YIELD': 8,
				},
				text: {
					SETOR: 'Industrial',
				},
			}),
		} as unknown as FundamentusFallbackAdapter;

		const facade = new TrackerrMarketDataFacade(stockService, fundamentus);
		const result = await facade.getAssetSnapshot('WEGE3');

		expect(result?.metadata.source).toBe('fallback_fundamentus');
		expect(result?.metadata.fallbackUsed).toBe(true);
		expect(result?.price).toBe(12);
	});

	it('uses b3 extension provider before fundamentus when available', async () => {
		const stockService = {
			getNationalQuote: jest.fn().mockRejectedValue(new Error('primary down')),
			getStockQuoteGlobal: jest
				.fn()
				.mockRejectedValue(new Error('global down')),
		} as unknown as StockService;
		const fundamentus = {
			getSnapshot: jest.fn(),
		} as unknown as FundamentusFallbackAdapter;
		const b3Provider = {
			getAssetSnapshot: jest.fn().mockResolvedValue({
				symbol: 'VALE3',
				assetType: 'stock',
				sector: 'Materials',
				price: 55,
				dividendYield: 0.07,
				performance: { changePercent: 1.1 },
				fundamentals: {
					priceToEarnings: 6,
					priceToBook: 1.2,
					returnOnEquity: 0.18,
					netMargin: 0.2,
					evEbitda: 4.5,
					marketCap: 100,
				},
				metadata: {
					source: 'primary',
					fallbackUsed: false,
					partial: false,
					fallbackSources: [],
				},
			}),
		};

		const facade = new TrackerrMarketDataFacade(
			stockService,
			fundamentus,
			b3Provider
		);
		const result = await facade.getAssetSnapshot('VALE3');

		expect(result?.price).toBe(55);
		expect(result?.metadata.fallbackUsed).toBe(true);
		expect(result?.metadata.fallbackSources).toEqual(
			expect.arrayContaining(['b3'])
		);
		expect(fundamentus.getSnapshot).not.toHaveBeenCalled();
	});

	it('degrades to fundamentus when b3 extension fails', async () => {
		const stockService = {
			getNationalQuote: jest.fn().mockRejectedValue(new Error('primary down')),
			getStockQuoteGlobal: jest
				.fn()
				.mockRejectedValue(new Error('global down')),
		} as unknown as StockService;
		const fundamentus = {
			getSnapshot: jest.fn().mockResolvedValue({
				numeric: {
					COTACAO: 18,
				},
				text: {
					SETOR: 'Financial',
				},
			}),
		} as unknown as FundamentusFallbackAdapter;
		const b3Provider = {
			getAssetSnapshot: jest.fn().mockRejectedValue(new Error('b3 down')),
		};

		const facade = new TrackerrMarketDataFacade(
			stockService,
			fundamentus,
			b3Provider
		);
		const result = await facade.getAssetSnapshot('BBAS3');

		expect(result?.metadata.source).toBe('fallback_fundamentus');
		expect(result?.price).toBe(18);
		expect(fundamentus.getSnapshot).toHaveBeenCalled();
	});
});
