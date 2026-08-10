import { TrackerrMarketDataFacade } from 'src/market-data/infrastructure/trackerr-market-data.facade';
import { FundamentusFallbackAdapter } from 'src/stocks/adapter/fundamentus-fallback.adapter';
import { StockService } from 'src/stocks/stocks.service';
import { BrapiAdapter } from 'src/stocks/adapter/brapiDataApi';
import { TwelveDataAdapter } from 'src/stocks/adapter/twelveDataApi';
import { CvmOpenDataAdapter } from 'src/stocks/adapter/cvm-open-data.adapter';
import { YahooFinanceAdapter } from 'src/market-data/infrastructure/yahoo-finance.adapter';

/**
 * Integration coverage for the seam that regressed in Finding 1 of the
 * final whole-branch review: TrackerrMarketDataFacade wired to a REAL
 * StockService (not a mocked one), with only the outbound adapters
 * (Brapi/Yahoo/Fundamentus) mocked. This exercises the full
 * getAssetSnapshot -> StockService.getNationalQuote -> Yahoo fallback ->
 * mapPrimarySnapshot chain end-to-end and asserts that a quote repaired by
 * Yahoo Finance is still correctly flagged as fallback-derived data.
 */
describe('TrackerrMarketDataFacade (integration with real StockService)', () => {
	it('flags fallbackUsed=true and includes yahoo_finance in fallbackSources when Yahoo fills valuation gaps Brapi left missing', async () => {
		const brapi = {
			getStockQuote: jest.fn().mockResolvedValue({
				results: [
					{
						symbol: 'PETR4',
						longName: 'Petrobras',
						shortName: 'Petrobras',
						sector: 'Energy',
						industry: 'Oil & Gas',
						longBusinessSummary: 'Petrobras exploration and refining.',
						regularMarketPrice: 30,
						regularMarketChangePercent: 1.5,
						// valuation fields intentionally missing/thin, forcing the
						// Yahoo Finance fallback path in StockService.getNationalQuote
						priceEarnings: null,
						priceToBook: null,
						returnOnEquity: null,
						netMargin: null,
						enterpriseValueEbitda: null,
						dividendYield: null,
						marketCap: null,
						returnOnInvestedCapital: 0.12,
						totalRevenue: 500000,
						netIncomeToCommon: 40000,
						totalAssets: 900000,
						totalStockholderEquity: 300000,
						totalDebt: 100000,
						cnpj: '',
					},
				],
			}),
		} as unknown as BrapiAdapter;

		const twelveData = {} as unknown as TwelveDataAdapter;

		const fundamentusInsideStockService = {
			getSnapshot: jest.fn().mockResolvedValue({ numeric: {}, text: {} }),
		} as unknown as FundamentusFallbackAdapter;

		const cvmAdapter = {
			getComputedIndicatorsHistoryByCnpj: jest.fn().mockResolvedValue([]),
		} as unknown as CvmOpenDataAdapter;

		const yahooFinance = {
			getSnapshot: jest.fn().mockResolvedValue({
				price: 30,
				dividendYield: 0.1,
				sector: 'Energy',
				changePercent: 1.5,
				priceToEarnings: 6,
				priceToBook: 1.2,
				returnOnEquity: 0.2,
				netMargin: 0.15,
				evEbitda: 4,
				marketCap: 150000,
			}),
		} as unknown as YahooFinanceAdapter;

		const stockService = new StockService(
			brapi,
			twelveData,
			fundamentusInsideStockService,
			cvmAdapter,
			yahooFinance
		);

		const fundamentusForFacade = {
			getSnapshot: jest.fn(),
		} as unknown as FundamentusFallbackAdapter;

		const facade = new TrackerrMarketDataFacade(
			stockService,
			fundamentusForFacade
		);

		const result = await facade.getAssetSnapshot('PETR4');

		expect(yahooFinance.getSnapshot).toHaveBeenCalled();
		expect(result?.metadata.source).toBe('primary');
		expect(result?.metadata.fallbackUsed).toBe(true);
		expect(result?.metadata.fallbackSources).toEqual(
			expect.arrayContaining(['yahoo_finance'])
		);
		expect(result?.fundamentals.priceToEarnings).toBe(6);
	});
});
