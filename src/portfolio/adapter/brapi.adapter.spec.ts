import { of, throwError } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { BrapiStockAdapter } from './brapi.adapter';
import { MarketDataProviderPort } from 'src/market-data/application/market-data-provider.port';

describe('BrapiStockAdapter.getIndicators', () => {
	function buildAdapter(
		brapiResponseData: any,
		marketDataSnapshot: any
	) {
		const httpService = {
			get: jest.fn().mockReturnValue(of({ data: brapiResponseData })),
		} as unknown as HttpService;
		const marketData = {
			getAssetSnapshot: jest.fn().mockResolvedValue(marketDataSnapshot),
		} as unknown as MarketDataProviderPort;

		const adapter = new BrapiStockAdapter(httpService, marketData);
		return { adapter, marketData };
	}

	it('uses Brapi indicators directly when present, without calling the market data port', async () => {
		const { adapter, marketData } = buildAdapter(
			{
				results: [
					{
						symbol: 'PETR4',
						regularMarketPrice: 30,
						regularMarketChange: 0.5,
						regularMarketChangePercent: 1.6,
						dividendYield: 0.1,
						epsTrailingTwelveMonths: 3,
						marketCap: 1000,
						regularMarketVolume: 500,
					},
				],
			},
			null
		);

		const result = await adapter.getIndicators('PETR4');

		expect(result.indicators?.dividendYield).toBe(0.1);
		expect(marketData.getAssetSnapshot).not.toHaveBeenCalled();
	});

	it('falls back to the market data port (Yahoo/Fundamentus via facade) when Brapi has no indicators', async () => {
		const { adapter, marketData } = buildAdapter(
			{
				results: [
					{
						symbol: 'WEGE3',
						regularMarketPrice: 40,
						regularMarketChange: 0,
						regularMarketChangePercent: 0,
						dividendYield: undefined,
						epsTrailingTwelveMonths: undefined,
					},
				],
			},
			{
				symbol: 'WEGE3',
				assetType: 'stock',
				sector: 'Industrials',
				price: 40,
				dividendYield: 0.02,
				performance: { changePercent: 0 },
				fundamentals: {
					priceToEarnings: 30,
					priceToBook: 12,
					returnOnEquity: 0.25,
					netMargin: 0.18,
					evEbitda: 20,
					marketCap: 150000,
				},
				metadata: {
					source: 'fallback_fundamentus',
					fallbackUsed: true,
					partial: false,
					fallbackSources: ['yahoo_finance'],
				},
			}
		);

		const result = await adapter.getIndicators('WEGE3');

		expect(marketData.getAssetSnapshot).toHaveBeenCalledWith('WEGE3');
		expect(result.indicators?.dividendYield).toBe(0.02);
		expect(result.indicators?.priceToEarnings).toBe(30);
		expect(result.indicators?.marketCap).toBe(150000);
	});

	it('leaves indicators undefined when both Brapi and the market data port have nothing', async () => {
		const { adapter } = buildAdapter(
			{
				results: [
					{
						symbol: 'ZZZZ9',
						regularMarketPrice: 1,
						regularMarketChange: 0,
						regularMarketChangePercent: 0,
					},
				],
			},
			null
		);

		const result = await adapter.getIndicators('ZZZZ9');

		expect(result.indicators).toBeUndefined();
	});
});
