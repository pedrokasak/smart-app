import { StockService } from './stocks.service';
import { BrapiAdapter } from './adapter/brapiDataApi';
import { TwelveDataAdapter } from './adapter/twelveDataApi';
import { FundamentusFallbackAdapter } from './adapter/fundamentus-fallback.adapter';
import { CvmOpenDataAdapter } from './adapter/cvm-open-data.adapter';
import { YahooFinanceAdapter } from 'src/market-data/infrastructure/yahoo-finance.adapter';

describe('StockService.getNationalQuote', () => {
	function buildService(overrides: {
		brapiResult: any;
		yahooSnapshot?: any;
		fundamentusSnapshot?: { numeric: Record<string, number>; text: Record<string, string> };
	}) {
		const brapi = {
			getStockQuote: jest
				.fn()
				.mockResolvedValue({ results: [overrides.brapiResult] }),
		} as unknown as BrapiAdapter;
		const twelveData = {} as TwelveDataAdapter;
		const fundamentusFallback = {
			getSnapshot: jest
				.fn()
				.mockResolvedValue(
					overrides.fundamentusSnapshot || { numeric: {}, text: {} }
				),
		} as unknown as FundamentusFallbackAdapter;
		const cvmAdapter = {
			getComputedIndicatorsHistoryByCnpj: jest.fn().mockResolvedValue([]),
		} as unknown as CvmOpenDataAdapter;
		const yahooFinance = {
			getSnapshot: jest.fn().mockResolvedValue(overrides.yahooSnapshot ?? null),
		} as unknown as YahooFinanceAdapter;

		const service = new StockService(
			brapi,
			twelveData,
			fundamentusFallback,
			cvmAdapter,
			yahooFinance
		);

		return { service, fundamentusFallback, yahooFinance };
	}

	it('fills missing fundamentals from Yahoo Finance before falling back to Fundamentus', async () => {
		const { service, fundamentusFallback, yahooFinance } = buildService({
			brapiResult: {
				symbol: 'WEGE3',
				priceEarnings: null,
				priceToBook: null,
				returnOnEquity: null,
				netMargin: null,
				enterpriseValueEbitda: null,
				dividendYield: null,
			},
			yahooSnapshot: {
				price: 40,
				dividendYield: 0.02,
				sector: 'Industrials',
				changePercent: 1,
				priceToEarnings: 30,
				priceToBook: 12,
				returnOnEquity: 0.25,
				netMargin: 0.18,
				evEbitda: 20,
				marketCap: 150000,
			},
		});

		const response = await service.getNationalQuote('WEGE3', {
			fundamental: true,
		});
		const result = response.results[0];

		expect(yahooFinance.getSnapshot).toHaveBeenCalledWith('WEGE3', 'stock');
		expect(result.priceEarnings).toBe(30);
		expect(result.priceToBook).toBe(12);
		expect(result.returnOnEquity).toBe(0.25);
		expect(result.fallbackSources).toContain('yahoo_finance');
		expect(fundamentusFallback.getSnapshot).not.toHaveBeenCalled();
	});

	it('falls back to Fundamentus for any field Yahoo Finance still leaves missing', async () => {
		const { service } = buildService({
			brapiResult: {
				symbol: 'WEGE3',
				priceEarnings: null,
				priceToBook: null,
				returnOnEquity: null,
				netMargin: null,
				enterpriseValueEbitda: null,
				dividendYield: null,
			},
			yahooSnapshot: {
				price: 40,
				dividendYield: null,
				sector: null,
				changePercent: null,
				priceToEarnings: null,
				priceToBook: 12,
				returnOnEquity: null,
				netMargin: null,
				evEbitda: null,
				marketCap: null,
			},
			fundamentusSnapshot: {
				numeric: { 'P/L': 6, 'DIV YIELD': 8 },
				text: {},
			},
		});

		const response = await service.getNationalQuote('WEGE3', {
			fundamental: true,
		});
		const result = response.results[0];

		expect(result.priceToBook).toBe(12); // from Yahoo
		expect(result.priceEarnings).toBe(6); // from Fundamentus
		expect(result.dividendYield).toBe(0.08); // from Fundamentus
		expect(result.fallbackSources).toEqual(
			expect.arrayContaining(['yahoo_finance', 'fundamentus'])
		);
	});

	it('does not call Yahoo Finance when Brapi already returned complete fundamentals', async () => {
		const { service, yahooFinance } = buildService({
			brapiResult: {
				symbol: 'PETR4',
				priceEarnings: 4,
				priceToBook: 1,
				returnOnEquity: 0.2,
				netMargin: 0.1,
				enterpriseValueEbitda: 3,
				dividendYield: 0.1,
			},
		});

		await service.getNationalQuote('PETR4', { fundamental: true });

		expect(yahooFinance.getSnapshot).not.toHaveBeenCalled();
	});

	it('continues to Fundamentus when Yahoo Finance returns null', async () => {
		const { service, fundamentusFallback } = buildService({
			brapiResult: {
				symbol: 'WEGE3',
				priceEarnings: null,
				priceToBook: null,
				returnOnEquity: null,
				netMargin: null,
				enterpriseValueEbitda: null,
				dividendYield: null,
			},
			yahooSnapshot: null,
			fundamentusSnapshot: { numeric: { 'P/L': 6 }, text: {} },
		});

		const response = await service.getNationalQuote('WEGE3', {
			fundamental: true,
		});

		expect(fundamentusFallback.getSnapshot).toHaveBeenCalled();
		expect(response.results[0].priceEarnings).toBe(6);
	});
});
