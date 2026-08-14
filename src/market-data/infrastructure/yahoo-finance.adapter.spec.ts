jest.mock('yahoo-finance2', () => ({
	__esModule: true,
	default: {
		quoteSummary: jest.fn(),
		chart: jest.fn(),
	},
}));

import { Logger } from '@nestjs/common';
import yahooFinance from 'yahoo-finance2';
import { YahooFinanceAdapter } from './yahoo-finance.adapter';

const mockedQuoteSummary = yahooFinance.quoteSummary as jest.Mock;
const mockedChart = (yahooFinance as any).chart as jest.Mock;

describe('YahooFinanceAdapter', () => {
	beforeEach(() => {
		mockedQuoteSummary.mockReset();
		mockedChart.mockReset();
		(YahooFinanceAdapter as any).rateLimitedUntil = 0;
	});

	it('maps a full quoteSummary response to a snapshot, normalizing the B3 ticker', async () => {
		mockedQuoteSummary.mockResolvedValue({
			price: {
				regularMarketPrice: 30.5,
				regularMarketChangePercent: 1.2,
			},
			summaryDetail: {
				dividendYield: 0.08,
				marketCap: 100000,
			},
			defaultKeyStatistics: {
				priceToBook: 1.4,
				enterpriseToEbitda: 5.2,
			},
			financialData: {
				returnOnEquity: 0.19,
				profitMargins: 0.11,
			},
			summaryProfile: {
				sector: 'Energy',
			},
		});

		const adapter = new YahooFinanceAdapter();
		const result = await adapter.getSnapshot('PETR4', 'stock');

		expect(mockedQuoteSummary).toHaveBeenCalledWith(
			'PETR4.SA',
			expect.objectContaining({
				modules: expect.arrayContaining([
					'price',
					'summaryDetail',
					'defaultKeyStatistics',
					'financialData',
					'summaryProfile',
				]),
			}),
			expect.anything()
		);
		expect(result).toEqual({
			price: 30.5,
			dividendYield: 0.08,
			sector: 'Energy',
			changePercent: 1.2,
			priceToEarnings: null,
			priceToBook: 1.4,
			returnOnEquity: 0.19,
			netMargin: 0.11,
			evEbitda: 5.2,
			marketCap: 100000,
		});
	});

	it('does not append .SA for a global ticker', async () => {
		mockedQuoteSummary.mockResolvedValue({
			price: { regularMarketPrice: 190, regularMarketChangePercent: 0.5 },
			summaryDetail: { dividendYield: 0.005, marketCap: 3000000 },
			defaultKeyStatistics: { priceToBook: 40 },
			financialData: { returnOnEquity: 1.5, profitMargins: 0.25 },
			summaryProfile: { sector: 'Technology' },
		});

		const adapter = new YahooFinanceAdapter();
		await adapter.getSnapshot('AAPL', 'stock');

		expect(mockedQuoteSummary).toHaveBeenCalledWith(
			'AAPL',
			expect.anything(),
			expect.anything()
		);
	});

	it('returns null when the ticker is not found', async () => {
		mockedQuoteSummary.mockRejectedValue(
			new Error('Quote not found for ticker symbol: ZZZZ9.SA')
		);

		const adapter = new YahooFinanceAdapter();
		const result = await adapter.getSnapshot('ZZZZ9', 'stock');

		expect(result).toBeNull();
	});

	it('returns null and does not throw on network/rate-limit errors', async () => {
		mockedQuoteSummary.mockRejectedValue(new Error('Too Many Requests'));

		const adapter = new YahooFinanceAdapter();
		await expect(adapter.getSnapshot('VALE3', 'stock')).resolves.toBeNull();
	});

	it('caches a successful response for the same normalized symbol', async () => {
		mockedQuoteSummary.mockResolvedValue({
			price: { regularMarketPrice: 10, regularMarketChangePercent: 0 },
			summaryDetail: { dividendYield: null, marketCap: null },
			defaultKeyStatistics: {},
			financialData: {},
			summaryProfile: {},
		});

		const adapter = new YahooFinanceAdapter();
		await adapter.getSnapshot('WEGE3', 'stock');
		await adapter.getSnapshot('WEGE3', 'stock');

		expect(mockedQuoteSummary).toHaveBeenCalledTimes(1);
	});

	it('negatively caches a failed lookup for the same normalized symbol, avoiding a repeat call', async () => {
		mockedQuoteSummary.mockRejectedValue(
			new Error('Quote not found for ticker symbol: NEGC1.SA')
		);

		const adapter = new YahooFinanceAdapter();
		const first = await adapter.getSnapshot('NEGC1', 'stock');
		const second = await adapter.getSnapshot('NEGC1', 'stock');

		expect(first).toBeNull();
		expect(second).toBeNull();
		expect(mockedQuoteSummary).toHaveBeenCalledTimes(1);
	});

	it('passes an abort signal via fetchOptions for a bounded timeout', async () => {
		mockedQuoteSummary.mockResolvedValue({
			price: { regularMarketPrice: 5, regularMarketChangePercent: 0 },
			summaryDetail: {},
			defaultKeyStatistics: {},
			financialData: {},
			summaryProfile: {},
		});

		const adapter = new YahooFinanceAdapter();
		await adapter.getSnapshot('TOUT3', 'stock');

		const callArgs = mockedQuoteSummary.mock.calls[0];
		expect(callArgs[2]).toEqual(
			expect.objectContaining({
				fetchOptions: expect.objectContaining({
					signal: expect.anything(),
				}),
			})
		);
	});

	describe('rate limit handling', () => {
		let warnSpy: jest.SpyInstance;

		beforeEach(() => {
			warnSpy = jest
				.spyOn(Logger.prototype, 'warn')
				.mockImplementation(() => undefined);
		});

		afterEach(() => {
			warnSpy.mockRestore();
		});

		it('triggers a global cooldown when the error exposes a 429 status', async () => {
			const rateLimitError = Object.assign(new Error('boom'), {
				response: { status: 429 },
			});
			mockedQuoteSummary.mockRejectedValueOnce(rateLimitError);

			const adapter = new YahooFinanceAdapter();
			const result = await adapter.getSnapshot('RATE1', 'stock');

			expect(result).toBeNull();
			expect((YahooFinanceAdapter as any).rateLimitedUntil).toBeGreaterThan(
				Date.now()
			);
		});

		it('triggers a global cooldown when the error message says Too Many Requests', async () => {
			mockedQuoteSummary.mockRejectedValueOnce(new Error('Too Many Requests'));

			const adapter = new YahooFinanceAdapter();
			const result = await adapter.getSnapshot('RATE2', 'stock');

			expect(result).toBeNull();
			expect((YahooFinanceAdapter as any).rateLimitedUntil).toBeGreaterThan(
				Date.now()
			);
		});

		it('skips the network call for a different symbol while the cooldown is active', async () => {
			mockedQuoteSummary.mockRejectedValueOnce(new Error('Too Many Requests'));

			const adapter = new YahooFinanceAdapter();
			await adapter.getSnapshot('RATE3', 'stock');
			mockedQuoteSummary.mockClear();

			const second = await adapter.getSnapshot('RATE4', 'stock');

			expect(second).toBeNull();
			expect(mockedQuoteSummary).not.toHaveBeenCalled();
		});

		it('still serves a valid positive cache entry during the cooldown', async () => {
			mockedQuoteSummary.mockResolvedValueOnce({
				price: { regularMarketPrice: 42, regularMarketChangePercent: 1 },
				summaryDetail: {},
				defaultKeyStatistics: {},
				financialData: {},
				summaryProfile: {},
			});

			const adapter = new YahooFinanceAdapter();
			const cachedResult = await adapter.getSnapshot('RATE5', 'stock');
			expect(cachedResult?.price).toBe(42);

			mockedQuoteSummary.mockRejectedValueOnce(new Error('Too Many Requests'));
			await adapter.getSnapshot('RATE6', 'stock');
			mockedQuoteSummary.mockClear();

			const stillCached = await adapter.getSnapshot('RATE5', 'stock');
			expect(stillCached?.price).toBe(42);
			expect(mockedQuoteSummary).not.toHaveBeenCalled();
		});

		it('does not trigger the cooldown for an ordinary error and only negative-caches that symbol', async () => {
			mockedQuoteSummary.mockRejectedValueOnce(
				new Error('Quote not found for ticker symbol: RATE7.SA')
			);

			const adapter = new YahooFinanceAdapter();
			const result = await adapter.getSnapshot('RATE7', 'stock');

			expect(result).toBeNull();
			expect((YahooFinanceAdapter as any).rateLimitedUntil).toBeLessThanOrEqual(
				Date.now()
			);

			mockedQuoteSummary.mockResolvedValueOnce({
				price: { regularMarketPrice: 7, regularMarketChangePercent: 0 },
				summaryDetail: {},
				defaultKeyStatistics: {},
				financialData: {},
				summaryProfile: {},
			});
			const otherSymbol = await adapter.getSnapshot('RATE8', 'stock');
			expect(otherSymbol?.price).toBe(7);
		});

		it('logs the rate-limit warning only once while the cooldown is active', async () => {
			mockedQuoteSummary.mockRejectedValueOnce(new Error('Too Many Requests'));

			const adapter = new YahooFinanceAdapter();
			await adapter.getSnapshot('RATE9', 'stock');
			await adapter.getSnapshot('RATE10', 'stock');
			await adapter.getSnapshot('RATE11', 'stock');

			const rateLimitWarnings = warnSpy.mock.calls.filter((call) =>
				String(call[0]).includes('rate limit')
			);
			expect(rateLimitWarnings).toHaveLength(1);
		});
	});

	describe('getHistory', () => {
		it('maps yahoo quotes to brapi-shaped points with epoch seconds', async () => {
			mockedChart.mockResolvedValue({
				quotes: [
					{ date: new Date('2026-01-02T00:00:00.000Z'), close: 10.5 },
					{ date: new Date('2026-01-03T00:00:00.000Z'), close: 11 },
				],
			});

			const adapter = new YahooFinanceAdapter();
			const history = await adapter.getHistory('BBAS3', 'stock', '1y');

			expect(history).toEqual([
				{ date: Math.floor(Date.UTC(2026, 0, 2) / 1000), close: 10.5 },
				{ date: Math.floor(Date.UTC(2026, 0, 3) / 1000), close: 11 },
			]);
		});

		it('drops points without a usable close', async () => {
			mockedChart.mockResolvedValue({
				quotes: [
					{ date: new Date('2026-01-02T00:00:00.000Z'), close: null },
					{ date: new Date('2026-01-03T00:00:00.000Z'), close: 11 },
				],
			});

			const adapter = new YahooFinanceAdapter();
			const history = await adapter.getHistory('BBAS3', 'stock', '1y');

			expect(history).toEqual([
				{ date: Math.floor(Date.UTC(2026, 0, 3) / 1000), close: 11 },
			]);
		});

		it('returns empty instead of throwing when yahoo fails', async () => {
			mockedChart.mockRejectedValue(new Error('boom'));

			const adapter = new YahooFinanceAdapter();

			await expect(adapter.getHistory('BBAS3', 'stock', '1y')).resolves.toEqual(
				[]
			);
		});

		it('returns empty without calling yahoo while the rate-limit cooldown is active', async () => {
			mockedChart.mockRejectedValue(new Error('Too Many Requests'));
			const adapter = new YahooFinanceAdapter();

			await adapter.getHistory('BBAS3', 'stock', '1y');
			mockedChart.mockClear();

			const second = await adapter.getHistory('PETR4', 'stock', '5y');

			expect(second).toEqual([]);
			expect(mockedChart).not.toHaveBeenCalled();
		});

		it('normalizes the ticker for yahoo before requesting', async () => {
			mockedChart.mockResolvedValue({ quotes: [] });
			const adapter = new YahooFinanceAdapter();

			await adapter.getHistory('BBAS3', 'stock', '1y');

			expect(mockedChart).toHaveBeenCalledWith(
				'BBAS3.SA',
				expect.objectContaining({ interval: '1d' })
			);
		});
	});
});
