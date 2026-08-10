jest.mock('yahoo-finance2', () => ({
	__esModule: true,
	default: {
		quoteSummary: jest.fn(),
	},
}));

import yahooFinance from 'yahoo-finance2';
import { YahooFinanceAdapter } from './yahoo-finance.adapter';

const mockedQuoteSummary = yahooFinance.quoteSummary as jest.Mock;

describe('YahooFinanceAdapter', () => {
	beforeEach(() => {
		mockedQuoteSummary.mockReset();
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
			})
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
			expect.anything()
		);
	});

	it('returns null when the ticker is not found', async () => {
		mockedQuoteSummary.mockRejectedValue(new Error('Quote not found for ticker symbol: ZZZZ9.SA'));

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
});
