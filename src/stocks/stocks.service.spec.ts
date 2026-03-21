import { Test, TestingModule } from '@nestjs/testing';
import { StockService } from './stocks.service';
import { TwelveDataAdapter } from 'src/stocks/adapter/twelveDataApi';
import { BrapiAdapter } from 'src/stocks/adapter/brapiDataApi';
import { jest } from '@jest/globals';
import { FundamentusFallbackAdapter } from 'src/stocks/adapter/fundamentus-fallback.adapter';
import { CvmOpenDataAdapter } from 'src/stocks/adapter/cvm-open-data.adapter';

describe('StockService', () => {
	let service: StockService;
	let brapi: { listAllStocks: jest.Mock; getStockQuote: jest.Mock };
	let twelveData: { getStockQuote: jest.Mock };
	let fundamentusFallback: { getIndicators: jest.Mock };
	let cvmAdapter: { getComputedIndicatorsByCnpj: jest.Mock };

	beforeEach(async () => {
		brapi = {
			listAllStocks: jest.fn(),
			getStockQuote: jest.fn(),
		};
		twelveData = {
			getStockQuote: jest.fn(),
		};
		fundamentusFallback = {
			getIndicators: jest.fn().mockResolvedValue({}),
		};
		cvmAdapter = {
			getComputedIndicatorsByCnpj: jest.fn().mockResolvedValue(null),
		};
		fundamentusFallback = {
			getIndicators: jest.fn().mockResolvedValue({}),
		};
		cvmAdapter = {
			getComputedIndicatorsByCnpj: jest.fn().mockResolvedValue(null),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				StockService,
				{ provide: BrapiAdapter, useValue: brapi },
				{ provide: TwelveDataAdapter, useValue: twelveData },
				{ provide: FundamentusFallbackAdapter, useValue: fundamentusFallback },
				{ provide: CvmOpenDataAdapter, useValue: cvmAdapter },
				{ provide: BrapiAdapter, useValue: brapi },
				{ provide: TwelveDataAdapter, useValue: twelveData },
			],
		}).compile();

		service = module.get<StockService>(StockService);
	});

	describe('getAllNational', () => {
		it('should call brapi.listAllStocks', async () => {
			brapi.listAllStocks.mockResolvedValue(['stock1', 'stock2']);
			brapi.listAllStocks.mockResolvedValue(['stock1', 'stock2']);
			const result = await service.getAllNational();
			expect(brapi.listAllStocks).toHaveBeenCalled();
			expect(result).toEqual(['stock1', 'stock2']);
		});
	});

	describe('getNationalQuote', () => {
		it('should call brapi.getStockQuote with formatted symbol', async () => {
			brapi.getStockQuote.mockResolvedValue({ price: 10 });
			brapi.getStockQuote.mockResolvedValue({ price: 10 });
			const result = await service.getNationalQuote(' petr4.sa ');
			expect(brapi.getStockQuote).toHaveBeenCalledWith('PETR4.SA', undefined);
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

			fundamentusFallback.getIndicators.mockResolvedValue({
				'P/L': 8.7,
				'P/VP': 1.3,
				'EV/EBITDA': 4.8,
				'ROE %': 22,
				'MARG. LIQUIDA': 13,
				'DIV. YIELD': 8.5,
				ROIC: 12,
			});

			cvmAdapter.getComputedIndicatorsByCnpj.mockResolvedValue({
				referenceYear: 2025,
				revenue: 100000,
				netIncome: 20000,
				totalAssets: 500000,
				shareholdersEquity: 90000,
				roe: 0.22,
				netMargin: 0.2,
			});

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

			fundamentusFallback.getIndicators.mockResolvedValue({
				'P/L': 8.7,
				'P/VP': 1.3,
				'EV/EBITDA': 4.8,
				'ROE %': 22,
				'MARG. LIQUIDA': 13,
				'DIV. YIELD': 8.5,
				ROIC: 12,
			});

			cvmAdapter.getComputedIndicatorsByCnpj.mockResolvedValue({
				referenceYear: 2025,
				revenue: 100000,
				netIncome: 20000,
				totalAssets: 500000,
				shareholdersEquity: 90000,
				roe: 0.22,
				netMargin: 0.2,
			});

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
		it('should call twelveData.getStockQuote with symbol', async () => {
			twelveData.getStockQuote.mockResolvedValue({ price: 20 });
			const result = await service.getStockQuoteGlobal('AAPL');
			expect(twelveData.getStockQuote).toHaveBeenCalledWith('AAPL');
			expect(result).toEqual({ price: 20 });
		});
	});
});
