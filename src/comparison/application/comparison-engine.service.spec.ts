import { ComparisonEngineService } from 'src/comparison/application/comparison-engine.service';
import {
	MarketDataProviderPort,
	MarketAssetSnapshot,
} from 'src/market-data/application/market-data-provider.port';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';

describe('ComparisonEngineService', () => {
	const makeSnapshot = (
		symbol: string,
		overrides: Partial<MarketAssetSnapshot> = {}
	): MarketAssetSnapshot => ({
		symbol,
		assetType: 'stock',
		sector: 'Financial',
		price: 10,
		dividendYield: 0.05,
		performance: { changePercent: 1.2 },
		fundamentals: {
			priceToEarnings: 8,
			priceToBook: 1.1,
			returnOnEquity: 0.18,
			netMargin: 0.2,
			evEbitda: 5,
			marketCap: 1000000,
		},
		metadata: {
			source: 'primary',
			fallbackUsed: false,
			partial: false,
			fallbackSources: [],
		},
		...overrides,
	});

	it('compares owned and non-owned assets with summary ranking', async () => {
		const marketDataProvider: MarketDataProviderPort = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn().mockResolvedValue([
				makeSnapshot('ITUB4', { dividendYield: 0.08, priceToEarnings: 7 } as any),
				makeSnapshot('BBAS3', {
					dividendYield: 0.06,
					performance: { changePercent: 2.1 },
					fundamentals: {
						priceToEarnings: 6,
						priceToBook: 1,
						returnOnEquity: 0.2,
						netMargin: 0.21,
						evEbitda: 4,
						marketCap: 1200000,
					},
				} as any),
			]),
		};

		const service = new ComparisonEngineService(
			marketDataProvider,
			new PortfolioIntelligenceService()
		);
		const result = await service.compareAssets({
			symbols: ['ITUB4', 'BBAS3'],
			portfolioPositions: [
				{
					symbol: 'ITUB4',
					assetType: 'stock',
					quantity: 10,
					totalValue: 1000,
					sector: 'Financial',
				},
			],
		});

		expect(result.results).toHaveLength(2);
		expect(result.executiveSummary.bestValuationSymbol).toBe('BBAS3');
		expect(result.results.find((item) => item.symbol === 'ITUB4')?.inPortfolio).toBe(
			true
		);
		expect(result.results.find((item) => item.symbol === 'BBAS3')?.inPortfolio).toBe(
			false
		);
		expect(result.byDimension.fundamentals).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					metric: 'priceToEarnings',
					preferredDirection: 'lower',
					winnerSymbol: 'BBAS3',
				}),
			])
		);
		expect(
			result.results.find((item) => item.symbol === 'BBAS3')?.fit.portfolioImpact
				.diversification
		).toBeDefined();
	});

	it('keeps fundamentus fallback metadata and handles partial data safely', async () => {
		const marketDataProvider: MarketDataProviderPort = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn().mockResolvedValue([
				makeSnapshot('PETR4', {
					fundamentals: {
						priceToEarnings: null,
						priceToBook: null,
						returnOnEquity: 0.12,
						netMargin: null,
						evEbitda: null,
						marketCap: 100,
					},
					metadata: {
						source: 'fallback_fundamentus',
						fallbackUsed: true,
						partial: true,
						fallbackSources: ['fundamentus'],
					},
				} as any),
			]),
		};

		const service = new ComparisonEngineService(
			marketDataProvider,
			new PortfolioIntelligenceService()
		);
		const result = await service.compareAssets({
			symbols: ['PETR4'],
			portfolioPositions: [],
		});

		expect(result.results[0].dataQuality.fallbackUsed).toBe(true);
		expect(result.results[0].dataQuality.partial).toBe(true);
		expect(result.results[0].dataQuality.fallbackSources).toEqual(['fundamentus']);
		expect(result.results[0].fit.classification).toBeDefined();
		expect(result.results[0].dataQuality.missingMetrics).toEqual(
			expect.arrayContaining(['priceToEarnings', 'priceToBook', 'netMargin'])
		);
		expect(result.byDimension.fundamentals).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					metric: 'priceToEarnings',
					winnerSymbol: null,
				}),
			])
		);
	});

	it('returns unavailable symbols when provider has no data', async () => {
		const marketDataProvider: MarketDataProviderPort = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn().mockResolvedValue([]),
		};

		const service = new ComparisonEngineService(
			marketDataProvider,
			new PortfolioIntelligenceService()
		);
		const result = await service.compareAssets({
			symbols: ['ABCD3', 'WXYZ4'],
			portfolioPositions: [],
		});

		expect(result.results).toHaveLength(0);
		expect(result.unavailableSymbols).toEqual(['ABCD3', 'WXYZ4']);
	});

	it('continues comparison with partial metrics from primary provider', async () => {
		const marketDataProvider: MarketDataProviderPort = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn().mockResolvedValue([
				makeSnapshot('AAPL', {
					performance: { changePercent: null },
					fundamentals: {
						priceToEarnings: 25,
						priceToBook: null,
						returnOnEquity: 0.21,
						netMargin: null,
						evEbitda: 18,
						marketCap: 3000000,
					},
					metadata: {
						source: 'primary',
						fallbackUsed: false,
						partial: true,
						fallbackSources: [],
					},
				} as any),
				makeSnapshot('MSFT', {
					fundamentals: {
						priceToEarnings: 28,
						priceToBook: 8,
						returnOnEquity: 0.24,
						netMargin: 0.3,
						evEbitda: 17,
						marketCap: 3500000,
					},
				} as any),
			]),
		};

		const service = new ComparisonEngineService(
			marketDataProvider,
			new PortfolioIntelligenceService()
		);
		const result = await service.compareAssets({
			symbols: ['AAPL', 'MSFT'],
			portfolioPositions: [],
		});

		expect(result.results).toHaveLength(2);
		expect(result.results.find((item) => item.symbol === 'AAPL')?.dataQuality.partial).toBe(
			true
		);
		expect(result.results.find((item) => item.symbol === 'AAPL')?.dataQuality.missingMetrics)
			.toEqual(expect.arrayContaining(['changePercent', 'priceToBook', 'netMargin']));
	});

	it('returns fit as bom when candidate can improve portfolio diversification', async () => {
		const marketDataProvider: MarketDataProviderPort = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn().mockResolvedValue([
				makeSnapshot('BTC', {
					assetType: 'crypto',
					sector: 'Digital Assets',
					price: 5000,
					dividendYield: null,
				}),
			]),
		};
		const service = new ComparisonEngineService(
			marketDataProvider,
			new PortfolioIntelligenceService()
		);

		const result = await service.compareAssets({
			symbols: ['BTC'],
			portfolioPositions: [
				{
					symbol: 'PETR4',
					assetType: 'stock',
					quantity: 1,
					totalValue: 7000,
					sector: 'Energy',
				},
				{
					symbol: 'VALE3',
					assetType: 'stock',
					quantity: 1,
					totalValue: 3000,
					sector: 'Materials',
				},
			],
		});

		expect(result.results[0].fit.classification).toBe('bom');
		expect(result.results[0].fit.portfolioImpact.diversification.deltaScore).toBeGreaterThan(
			0
		);
	});

	it('returns fit as ruim when candidate worsens concentration', async () => {
		const marketDataProvider: MarketDataProviderPort = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn().mockResolvedValue([
				makeSnapshot('PRIO3', {
					assetType: 'stock',
					sector: 'Energy',
					price: 5000,
				}),
			]),
		};
		const service = new ComparisonEngineService(
			marketDataProvider,
			new PortfolioIntelligenceService()
		);

		const result = await service.compareAssets({
			symbols: ['PRIO3'],
			portfolioPositions: [
				{
					symbol: 'PETR4',
					assetType: 'stock',
					quantity: 1,
					totalValue: 8000,
					sector: 'Energy',
				},
				{
					symbol: 'BBAS3',
					assetType: 'stock',
					quantity: 1,
					totalValue: 2000,
					sector: 'Financial',
				},
			],
		});

		expect(result.results[0].fit.classification).toBe('ruim');
		expect(
			result.results[0].fit.portfolioImpact.concentration.assetPercentageDelta
		).toBeGreaterThan(0);
		expect(result.results[0].fit.portfolioImpact.sectorExposure.deltaPercentage).toBeGreaterThan(
			0
		);
	});

	it('degrades fit safely when candidate has incomplete metadata', async () => {
		const marketDataProvider: MarketDataProviderPort = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn().mockResolvedValue([
				makeSnapshot('ABCD3', {
					assetType: 'stock',
					sector: null,
					price: null,
					metadata: {
						source: 'fallback_fundamentus',
						fallbackUsed: true,
						partial: true,
						fallbackSources: ['fundamentus'],
					},
				}),
			]),
		};
		const service = new ComparisonEngineService(
			marketDataProvider,
			new PortfolioIntelligenceService()
		);

		const result = await service.compareAssets({
			symbols: ['ABCD3'],
			portfolioPositions: [
				{
					symbol: 'ITUB4',
					assetType: 'stock',
					quantity: 1,
					totalValue: 10000,
					sector: 'Financial',
				},
			],
		});

		expect(result.results[0].fit.classification).toBe('neutro');
		expect(result.results[0].fit.portfolioImpact.confidence).toBe('low');
	});

	it('keeps fit usable when compared asset is already in portfolio', async () => {
		const marketDataProvider: MarketDataProviderPort = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn().mockResolvedValue([
				makeSnapshot('ITUB4', {
					assetType: 'stock',
					sector: 'Financial',
					price: 400,
				}),
			]),
		};
		const service = new ComparisonEngineService(
			marketDataProvider,
			new PortfolioIntelligenceService()
		);

		const result = await service.compareAssets({
			symbols: ['ITUB4'],
			portfolioPositions: [
				{
					symbol: 'ITUB4',
					assetType: 'stock',
					quantity: 10,
					totalValue: 4000,
					sector: 'Financial',
				},
				{
					symbol: 'XPLG11',
					assetType: 'fii',
					quantity: 5,
					totalValue: 6000,
					sector: 'Logistics',
				},
			],
		});

		expect(result.results[0].inPortfolio).toBe(true);
		expect(result.results[0].fit.portfolioImpact.alreadyInPortfolio).toBe(true);
		expect(
			result.results[0].fit.portfolioImpact.concentration.assetPercentageAfter
		).toBeGreaterThan(result.results[0].fit.portfolioImpact.concentration.assetPercentageBefore);
	});
});
