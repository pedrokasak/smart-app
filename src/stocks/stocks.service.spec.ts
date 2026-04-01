import { Test, TestingModule } from '@nestjs/testing';
import { StockService } from './stocks.service';
import { TwelveDataAdapter } from 'src/stocks/adapter/twelveDataApi';
import { BrapiAdapter } from 'src/stocks/adapter/brapiDataApi';
import { FundamentusFallbackAdapter } from 'src/stocks/adapter/fundamentus-fallback.adapter';
import { CvmOpenDataAdapter } from 'src/stocks/adapter/cvm-open-data.adapter';
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
	type FundamentusGetSnapshotFn = (
		symbol: string
	) => Promise<{
		numeric: Record<string, number>;
		text: Record<string, string>;
	}>;
	type CvmGetIndicatorsHistoryFn = (
		cnpj: string,
		years: number[]
	) => Promise<any[]>;

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

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				StockService,
				{ provide: BrapiAdapter, useValue: brapi },
				{ provide: TwelveDataAdapter, useValue: twelveData },
				{ provide: FundamentusFallbackAdapter, useValue: fundamentusFallback },
				{ provide: CvmOpenDataAdapter, useValue: cvmAdapter },
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
			expect(brapi.getStockQuote).toHaveBeenCalledWith('AAPL');
			expect(result.source).toBe('brapi');
			expect(result.fallbackSources).toEqual(['twelve_data']);
			expect(result.results[0].symbol).toBe('AAPL');
		});

		it('should return graceful degradation when all providers fail', async () => {
			twelveData.getStockQuote.mockRejectedValue(new Error('timeout'));
			brapi.getStockQuote.mockRejectedValue(new Error('unavailable'));

			const result = await service.getStockQuoteGlobal('msft');

			expect(result.source).toBe('unavailable');
			expect(result.results[0].symbol).toBe('MSFT');
			expect(result.results[0].unavailable).toBe(true);
			expect(result.fallbackSources).toEqual(['twelve_data', 'brapi']);
		});
	});
});
