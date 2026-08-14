import { Test, TestingModule } from '@nestjs/testing';
import { StockService } from './stocks.service';
import { TwelveDataAdapter } from 'src/stocks/adapter/twelveDataApi';
import { BrapiAdapter } from 'src/stocks/adapter/brapiDataApi';
import { FundamentusFallbackAdapter } from 'src/stocks/adapter/fundamentus-fallback.adapter';
import { CvmOpenDataAdapter } from 'src/stocks/adapter/cvm-open-data.adapter';
import { YahooFinanceAdapter } from 'src/market-data/infrastructure/yahoo-finance.adapter';
import { jest } from '@jest/globals';

describe('StockService', () => {
	let service: StockService;
	type BrapiListAllStocksFn = (
		search?: string,
		sortBy?: string,
		sortOrder?: string,
		limit?: number,
		page?: number
	) => Promise<any>;
	type BrapiGetStockQuoteFn = (
		symbol: string,
		options?: {
			range?: string;
			interval?: string;
			fundamental?: boolean;
			dividends?: boolean;
		}
	) => Promise<any>;
	type TwelveGetStockQuoteFn = (symbol: string) => Promise<any>;
	type FundamentusGetSnapshotFn = (symbol: string) => Promise<{
		numeric: Record<string, number>;
		text: Record<string, string>;
	}>;
	type CvmGetIndicatorsHistoryFn = (
		cnpj: string,
		years: number[]
	) => Promise<any[]>;
	type YahooGetSnapshotFn = (symbol: string, assetType: string) => Promise<any>;

	let brapi: {
		listAllStocks: jest.MockedFunction<BrapiListAllStocksFn>;
		getStockQuote: jest.MockedFunction<BrapiGetStockQuoteFn>;
	};
	let twelveData: { getStockQuote: jest.MockedFunction<TwelveGetStockQuoteFn> };
	let fundamentusFallback: {
		getSnapshot: jest.MockedFunction<FundamentusGetSnapshotFn>;
	};
	let cvmAdapter: {
		getComputedIndicatorsHistoryByCnpj: jest.MockedFunction<CvmGetIndicatorsHistoryFn>;
	};
	let yahooFinance: {
		getSnapshot: jest.MockedFunction<YahooGetSnapshotFn>;
	};

	beforeEach(async () => {
		brapi = {
			listAllStocks: jest.fn<BrapiListAllStocksFn>(),
			getStockQuote: jest.fn<BrapiGetStockQuoteFn>(),
		};
		twelveData = {
			getStockQuote: jest.fn<TwelveGetStockQuoteFn>(),
		};
		fundamentusFallback = {
			getSnapshot: jest
				.fn<FundamentusGetSnapshotFn>()
				.mockResolvedValue({ numeric: {}, text: {} }),
		};
		cvmAdapter = {
			getComputedIndicatorsHistoryByCnpj: jest
				.fn<CvmGetIndicatorsHistoryFn>()
				.mockResolvedValue([]),
		};
		yahooFinance = {
			getSnapshot: jest.fn<YahooGetSnapshotFn>().mockResolvedValue(null),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				StockService,
				{ provide: BrapiAdapter, useValue: brapi },
				{ provide: TwelveDataAdapter, useValue: twelveData },
				{ provide: FundamentusFallbackAdapter, useValue: fundamentusFallback },
				{ provide: CvmOpenDataAdapter, useValue: cvmAdapter },
				{ provide: YahooFinanceAdapter, useValue: yahooFinance },
			],
		}).compile();

		service = module.get<StockService>(StockService);
	});

	describe('getAllNational', () => {
		it('should call brapi.listAllStocks', async () => {
			brapi.listAllStocks.mockResolvedValue(['stock1', 'stock2']);
			const result = await service.getAllNational();
			expect(brapi.listAllStocks).toHaveBeenCalled();
			expect(result).toEqual(['stock1', 'stock2']);
		});
	});

	describe('getNationalQuote', () => {
		it('should call brapi.getStockQuote with formatted symbol', async () => {
			brapi.getStockQuote.mockResolvedValue({ price: 10 });
			const result = await service.getNationalQuote(' petr4.sa ');
			expect(brapi.getStockQuote).toHaveBeenCalledWith('PETR4.SA', undefined);
			expect(result).toEqual({ price: 10 });
		});

		it('should enrich missing fundamentals with Fundamentus and CVM fallback', async () => {
			brapi.getStockQuote.mockResolvedValue({
				results: [
					{
						symbol: 'PETR4',
						cnpj: '33.000.167/0001-01',
						priceEarnings: 0,
						priceToBook: null,
						enterpriseValueEbitda: undefined,
						returnOnEquity: 0,
						netMargin: 0,
						dividendYield: 0,
						totalRevenue: 0,
						netIncomeToCommon: 0,
						totalAssets: 0,
						totalStockholderEquity: 0,
						restrictedData: ['fundamental'],
					},
				],
			});

			fundamentusFallback.getSnapshot.mockResolvedValue({
				numeric: {
					'P/L': 8.7,
					'P/VP': 1.3,
					'EV/EBITDA': 4.8,
					'ROE %': 22,
					'MARG. LIQUIDA': 13,
					'DIV. YIELD': 8.5,
					ROIC: 12,
				},
				text: {},
			});

			cvmAdapter.getComputedIndicatorsHistoryByCnpj.mockResolvedValue([
				{
					referenceYear: 2025,
					revenue: 100000,
					netIncome: 20000,
					totalAssets: 500000,
					shareholdersEquity: 90000,
					roe: 0.22,
					netMargin: 0.2,
				},
			]);

			const result = await service.getNationalQuote('PETR4', {
				fundamental: true,
				dividends: true,
			});

			const merged = result.results[0];
			expect(merged.priceEarnings).toBe(8.7);
			expect(merged.priceToBook).toBe(1.3);
			expect(merged.enterpriseValueEbitda).toBe(4.8);
			expect(merged.returnOnEquity).toBeCloseTo(0.22, 4);
			expect(merged.netMargin).toBeCloseTo(0.13, 4);
			expect(merged.dividendYield).toBeCloseTo(0.085, 4);
			expect(merged.returnOnInvestedCapital).toBeCloseTo(0.12, 4);
			expect(merged.totalRevenue).toBe(100000);
			expect(merged.netIncomeToCommon).toBe(20000);
			expect(merged.totalAssets).toBe(500000);
			expect(merged.totalStockholderEquity).toBe(90000);
			expect(merged.fallbackSources).toEqual(
				expect.arrayContaining(['fundamentus', 'cvm_open_data'])
			);
		});
	});

	describe('getStockQuoteGlobal', () => {
		it('should use primary provider (twelve_data) and normalize response envelope', async () => {
			twelveData.getStockQuote.mockResolvedValue({
				symbol: 'AAPL',
				close: '221.15',
				percent_change: '1.34',
			});

			const result = await service.getStockQuoteGlobal('AAPL');

			expect(twelveData.getStockQuote).toHaveBeenCalledWith('AAPL');
			expect(brapi.getStockQuote).not.toHaveBeenCalled();
			expect(result.source).toBe('twelve_data');
			expect(result.results[0].symbol).toBe('AAPL');
			expect(result.results[0].close).toBe('221.15');
			expect(result.fallbackSources).toEqual([]);
		});

		it('should fallback to brapi when twelve_data fails', async () => {
			twelveData.getStockQuote.mockRejectedValue(new Error('provider down'));
			brapi.getStockQuote.mockResolvedValue({
				results: [{ symbol: 'AAPL', regularMarketPrice: 221.15 }],
				requestedAt: '2026-03-25T00:00:00.000Z',
				took: '4ms',
			});

			const result = await service.getStockQuoteGlobal('AAPL');

			expect(twelveData.getStockQuote).toHaveBeenCalledWith('AAPL');
			expect(yahooFinance.getSnapshot).toHaveBeenCalledWith('AAPL', 'stock');
			expect(brapi.getStockQuote).toHaveBeenCalledWith('AAPL');
			expect(result.source).toBe('brapi');
			expect(result.fallbackSources).toEqual(['twelve_data', 'yahoo_finance']);
			expect(result.results[0].symbol).toBe('AAPL');
		});

		it('should return graceful degradation when all providers fail', async () => {
			twelveData.getStockQuote.mockRejectedValue(new Error('timeout'));
			brapi.getStockQuote.mockRejectedValue(new Error('unavailable'));

			const result = await service.getStockQuoteGlobal('msft');

			expect(result.source).toBe('unavailable');
			expect(result.results[0].symbol).toBe('MSFT');
			expect(result.results[0].unavailable).toBe(true);
			expect(result.fallbackSources).toEqual([
				'twelve_data',
				'yahoo_finance',
				'brapi',
			]);
		});
	});
});

describe('StockService.getNationalQuote — Yahoo Finance fallback chain', () => {
	function buildService(overrides: {
		brapiResult: any;
		yahooSnapshot?: any;
		fundamentusSnapshot?: {
			numeric: Record<string, number>;
			text: Record<string, string>;
		};
	}) {
		const brapi = {
			getStockQuote: jest
				.fn<(symbol: string, options?: any) => Promise<any>>()
				.mockResolvedValue({ results: [overrides.brapiResult] }),
		} as unknown as BrapiAdapter;
		const twelveData = {} as TwelveDataAdapter;
		const fundamentusFallback = {
			getSnapshot: jest
				.fn<(symbol: string) => Promise<any>>()
				.mockResolvedValue(
					overrides.fundamentusSnapshot || { numeric: {}, text: {} }
				),
		} as unknown as FundamentusFallbackAdapter;
		const cvmAdapter = {
			getComputedIndicatorsHistoryByCnpj: jest
				.fn<(cnpj: string, years: number[]) => Promise<any[]>>()
				.mockResolvedValue([]),
		} as unknown as CvmOpenDataAdapter;
		const yahooFinance = {
			getSnapshot: jest
				.fn<(symbol: string, assetType: string) => Promise<any>>()
				.mockResolvedValue(overrides.yahooSnapshot ?? null),
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
		// Brapi already supplies everything Fundamentus would otherwise be the
		// only source for (company profile + balance-sheet/income fields), so
		// once Yahoo fills the 6 valuation fields there is nothing left for
		// Fundamentus to contribute and it should be skipped for performance.
		const { service, fundamentusFallback, yahooFinance } = buildService({
			brapiResult: {
				symbol: 'WEGE3',
				longName: 'WEG S.A.',
				industry: 'Electrical Equipment',
				longBusinessSummary: 'WEG manufactures electrical equipment.',
				priceEarnings: null,
				priceToBook: null,
				returnOnEquity: null,
				netMargin: null,
				enterpriseValueEbitda: null,
				dividendYield: null,
				returnOnInvestedCapital: 0.2,
				totalRevenue: 30000,
				netIncomeToCommon: 4000,
				totalAssets: 25000,
				totalStockholderEquity: 12000,
				totalDebt: 3000,
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

	it('still calls Fundamentus when Yahoo fills the 6 valuation fields but Brapi is missing company profile / balance-sheet fields', async () => {
		const { service, fundamentusFallback } = buildService({
			brapiResult: {
				symbol: 'WEGE3',
				// No longName/industry/longBusinessSummary and no
				// returnOnInvestedCapital/totalRevenue/netIncomeToCommon/
				// totalAssets/totalStockholderEquity/totalDebt — these are
				// fields only Fundamentus (not Yahoo) can fill.
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
			fundamentusSnapshot: {
				numeric: { ROIC: 15 },
				text: {
					EMPRESA: 'WEG S.A.',
					SETOR: 'Industrials',
					SUBSETOR: 'Bens de Capital',
				},
			},
		});

		const response = await service.getNationalQuote('WEGE3', {
			fundamental: true,
		});
		const result = response.results[0];

		expect(fundamentusFallback.getSnapshot).toHaveBeenCalledWith('WEGE3');
		expect(result.priceEarnings).toBe(30); // still from Yahoo
		expect(result.longName).toBe('WEG S.A.'); // filled by Fundamentus
		expect(result.returnOnInvestedCapital).toBeCloseTo(0.15, 4); // filled by Fundamentus
		expect(result.fallbackSources).toEqual(
			expect.arrayContaining(['yahoo_finance', 'fundamentus'])
		);
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

describe('StockService.getNationalQuote — period routing', () => {
	function makeBrapi(response: any) {
		return {
			getStockQuote: jest
				.fn<(symbol: string, options?: any) => Promise<any>>()
				.mockResolvedValue(response),
		} as unknown as BrapiAdapter & {
			getStockQuote: jest.MockedFunction<(symbol: string, options?: any) => Promise<any>>;
		};
	}

	function makeService(brapi: any, yahoo: any) {
		const twelveData = {} as TwelveDataAdapter;
		const fundamentusFallback = {
			getSnapshot: jest
				.fn<(symbol: string) => Promise<any>>()
				.mockResolvedValue({ numeric: {}, text: {} }),
		} as unknown as FundamentusFallbackAdapter;
		const cvmAdapter = {
			getComputedIndicatorsHistoryByCnpj: jest
				.fn<(cnpj: string, years: number[]) => Promise<any[]>>()
				.mockResolvedValue([]),
		} as unknown as CvmOpenDataAdapter;

		return new StockService(
			brapi,
			twelveData,
			fundamentusFallback,
			cvmAdapter,
			yahoo
		);
	}

	afterEach(() => {
		delete process.env.BRAPI_SUPPORTED_RANGES;
	});

	it('uses brapi alone for a range the plan serves', async () => {
		const brapi = makeBrapi({
			results: [{ symbol: 'BBAS3', historicalDataPrice: [{ date: 1, close: 2 }] }],
		});
		const yahoo = {
			getSnapshot: jest.fn<(symbol: string, assetType: string) => Promise<any>>(),
			getHistory: jest.fn<(symbol: string, assetType: string, range: string) => Promise<any[]>>(),
		};
		const service = makeService(brapi, yahoo);

		const response = await service.getNationalQuote('BBAS3', {
			range: '1mo',
			interval: '1d',
		});

		expect(yahoo.getHistory).not.toHaveBeenCalled();
		expect(response.results[0].historicalDataPrice).toEqual([
			{ date: 1, close: 2 },
		]);
		expect(brapi.getStockQuote).toHaveBeenCalledWith(
			'BBAS3',
			expect.objectContaining({ range: '1mo' })
		);
	});

	it('asks brapi for a supported range and yahoo for the history when the plan cannot serve it', async () => {
		const brapi = makeBrapi({
			results: [{ symbol: 'BBAS3', historicalDataPrice: [] }],
		});
		const yahoo = {
			getSnapshot: jest.fn<(symbol: string, assetType: string) => Promise<any>>(),
			getHistory: jest
				.fn<(symbol: string, assetType: string, range: string) => Promise<any[]>>()
				.mockResolvedValue([{ date: 1700000000, close: 25.5 }]),
		};
		const service = makeService(brapi, yahoo);

		const response = await service.getNationalQuote('BBAS3', {
			range: '5y',
			interval: '1d',
		});

		expect(yahoo.getHistory).toHaveBeenCalledWith('BBAS3', 'stock', '5y');
		expect(response.results[0].historicalDataPrice).toEqual([
			{ date: 1700000000, close: 25.5 },
		]);
		expect(brapi.getStockQuote).toHaveBeenCalledWith(
			'BBAS3',
			expect.not.objectContaining({ range: '5y' })
		);
	});

	it('routes through brapi once the env declares the range as supported', async () => {
		process.env.BRAPI_SUPPORTED_RANGES = '1d,5d,1mo,3mo,6mo,1y,5y';
		const brapi = makeBrapi({
			results: [{ symbol: 'BBAS3', historicalDataPrice: [{ date: 9, close: 9 }] }],
		});
		const yahoo = {
			getSnapshot: jest.fn<(symbol: string, assetType: string) => Promise<any>>(),
			getHistory: jest.fn<(symbol: string, assetType: string, range: string) => Promise<any[]>>(),
		};
		const service = makeService(brapi, yahoo);

		await service.getNationalQuote('BBAS3', { range: '5y', interval: '1d' });

		expect(yahoo.getHistory).not.toHaveBeenCalled();
		expect(brapi.getStockQuote).toHaveBeenCalledWith(
			'BBAS3',
			expect.objectContaining({ range: '5y' })
		);
	});

	it('keeps the brapi quote when yahoo history fails', async () => {
		const brapi = makeBrapi({
			results: [
				{ symbol: 'BBAS3', regularMarketPrice: 20, historicalDataPrice: [] },
			],
		});
		const yahoo = {
			getSnapshot: jest.fn<(symbol: string, assetType: string) => Promise<any>>(),
			getHistory: jest
				.fn<(symbol: string, assetType: string, range: string) => Promise<any[]>>()
				.mockResolvedValue([]),
		};
		const service = makeService(brapi, yahoo);

		const response = await service.getNationalQuote('BBAS3', {
			range: '1y',
			interval: '1d',
		});

		expect(response.results[0].regularMarketPrice).toBe(20);
		expect(response.results[0].historicalDataPrice).toEqual([]);
	});
});

describe('StockService.getStockQuoteGlobal', () => {
	function buildService(overrides: {
		twelveDataError?: boolean;
		yahooSnapshot?: any;
		brapiResult?: any;
	}) {
		const brapi = {
			getStockQuote: jest
				.fn<(symbol: string, options?: any) => Promise<any>>()
				.mockResolvedValue({
					results: [overrides.brapiResult || { symbol: 'AAPL' }],
				}),
		} as unknown as BrapiAdapter;
		const twelveData = {
			getStockQuote: overrides.twelveDataError
				? jest
						.fn<(symbol: string) => Promise<any>>()
						.mockRejectedValue(new Error('twelve data down'))
				: jest
						.fn<(symbol: string) => Promise<any>>()
						.mockResolvedValue({ results: [{ symbol: 'AAPL', price: 190 }] }),
		} as unknown as TwelveDataAdapter;
		const fundamentusFallback = {
			getSnapshot: jest.fn<(symbol: string) => Promise<any>>(),
		} as unknown as FundamentusFallbackAdapter;
		const cvmAdapter = {} as unknown as CvmOpenDataAdapter;
		const yahooFinance = {
			getSnapshot: jest
				.fn<(symbol: string, assetType: string) => Promise<any>>()
				.mockResolvedValue(overrides.yahooSnapshot ?? null),
		} as unknown as YahooFinanceAdapter;

		return new StockService(
			brapi,
			twelveData,
			fundamentusFallback,
			cvmAdapter,
			yahooFinance
		);
	}

	it('uses Twelve Data when it succeeds, without calling Yahoo Finance', async () => {
		const service = buildService({});
		const result = await service.getStockQuoteGlobal('AAPL');

		expect(result.source).toBe('twelve_data');
	});

	it('falls back to Yahoo Finance when Twelve Data fails, before Brapi', async () => {
		const service = buildService({
			twelveDataError: true,
			yahooSnapshot: {
				price: 191,
				dividendYield: 0.005,
				sector: 'Technology',
				changePercent: 0.3,
				priceToEarnings: 28,
				priceToBook: 40,
				returnOnEquity: 1.5,
				netMargin: 0.25,
				evEbitda: 22,
				marketCap: 3000000,
			},
		});

		const result = await service.getStockQuoteGlobal('AAPL');

		expect(result.source).toBe('yahoo_finance');
		expect(result.results[0].price).toBe(191);
	});

	it('falls back to Brapi when both Twelve Data and Yahoo Finance fail', async () => {
		const service = buildService({
			twelveDataError: true,
			yahooSnapshot: null,
			brapiResult: { symbol: 'AAPL', regularMarketPrice: 189 },
		});

		const result = await service.getStockQuoteGlobal('AAPL');

		expect(result.source).toBe('brapi');
		expect(result.fallbackSources).toEqual(['twelve_data', 'yahoo_finance']);
	});
});
