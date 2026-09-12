import { IntelligentChatService } from 'src/ai/intelligence/intelligent-chat.service';
import { ComparisonEngineService } from 'src/comparison/application/comparison-engine.service';
import { MarketDataProviderPort } from 'src/market-data/application/market-data-provider.port';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';

describe('IntelligentChatService', () => {
	const mockPortfolioService: Pick<PortfolioService, 'getUserPortfolios'> = {
		getUserPortfolios: jest.fn(),
	};

	const mockComparisonService: Pick<ComparisonEngineService, 'compareAssets'> =
		{
			compareAssets: jest.fn(),
		};

	const mockMarketDataProvider: MarketDataProviderPort = {
		getAssetSnapshot: jest.fn(),
		getManyAssetSnapshots: jest.fn(),
	};

	let service: IntelligentChatService;

	beforeEach(() => {
		service = new IntelligentChatService(
			mockPortfolioService as PortfolioService,
			new PortfolioIntelligenceService(),
			mockComparisonService as ComparisonEngineService,
			mockMarketDataProvider
		);
	});

	afterEach(() => jest.clearAllMocks());

	it('handles question about owned asset', async () => {
		(mockPortfolioService.getUserPortfolios as jest.Mock).mockResolvedValue([
			{
				assets: [
					{
						symbol: 'ITUB4',
						type: 'stock',
						quantity: 10,
						total: 1000,
						price: 100,
						sector: 'Financial',
					},
				],
			},
		]);
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue({
			symbol: 'ITUB4',
			assetType: 'stock',
			sector: 'Financial',
			price: 110,
			dividendYield: 0.08,
			performance: { changePercent: 1.2 },
			fundamentals: {
				priceToEarnings: 8,
				priceToBook: 1,
				returnOnEquity: 0.18,
				netMargin: 0.2,
				evEbitda: 4,
				marketCap: 100,
			},
			metadata: {
				source: 'primary',
				fallbackUsed: false,
				partial: false,
				fallbackSources: [],
			},
		});

		const response = await service.respond('user-1', 'Me fale sobre ITUB4');

		expect(response.intent).toBe('asset_analysis');
		expect(response.portfolioFacts?.symbol).toBe('ITUB4');
		expect(response.externalData).not.toBeNull();
	});

	it('handles question about external asset', async () => {
		(mockPortfolioService.getUserPortfolios as jest.Mock).mockResolvedValue([
			{ assets: [] },
		]);
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue({
			symbol: 'PETR4',
			assetType: 'stock',
			sector: 'Energy',
			price: 32,
			dividendYield: 0.1,
			performance: { changePercent: 1.5 },
			fundamentals: {
				priceToEarnings: 5,
				priceToBook: 1,
				returnOnEquity: 0.2,
				netMargin: 0.12,
				evEbitda: 3,
				marketCap: 100,
			},
			metadata: {
				source: 'primary',
				fallbackUsed: false,
				partial: false,
				fallbackSources: [],
			},
		});
		(mockComparisonService.compareAssets as jest.Mock).mockResolvedValue({
			executiveSummary: {
				bestDividendSymbol: 'PETR4',
				bestMomentumSymbol: 'PETR4',
				bestValuationSymbol: 'PETR4',
				bestFitSymbol: 'PETR4',
			},
			results: [{ fit: { score: 70, status: 'strong', reasons: [] } }],
			unavailableSymbols: [],
		});

		const response = await service.respond('user-1', 'PETR4 vale a pena?');

		expect(response.intent).toBe('external_asset_question');
		expect(response.portfolioFacts?.owned).toBe(false);
		expect(response.estimates?.fit).toBeDefined();
	});

	it('handles comparison questions', async () => {
		(mockPortfolioService.getUserPortfolios as jest.Mock).mockResolvedValue([
			{ assets: [] },
		]);
		(mockComparisonService.compareAssets as jest.Mock).mockResolvedValue({
			executiveSummary: {
				bestDividendSymbol: 'BBAS3',
				bestMomentumSymbol: 'ITUB4',
				bestValuationSymbol: 'BBAS3',
				bestFitSymbol: 'BBAS3',
			},
			results: [
				{ symbol: 'BBAS3', inPortfolio: false },
				{ symbol: 'ITUB4', inPortfolio: false },
			],
			unavailableSymbols: [],
		});

		const response = await service.respond('user-1', 'Compare BBAS3 vs ITUB4');

		expect(response.intent).toBe('asset_comparison');
		expect(response.externalData?.comparison).toBeDefined();
	});

	it('handles absence of data safely', async () => {
		(mockPortfolioService.getUserPortfolios as jest.Mock).mockResolvedValue([
			{ assets: [] },
		]);
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue(
			null
		);

		const response = await service.respond('user-1', 'Fale sobre ABCD3');

		expect(response.intent).toBe('external_asset_question');
		expect(response.unavailable).toEqual(['ABCD3']);
		expect(response.externalData).toBeNull();
	});

	it('handles provider failure with fallback data', async () => {
		(mockPortfolioService.getUserPortfolios as jest.Mock).mockResolvedValue([
			{ assets: [] },
		]);
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue({
			symbol: 'VALE3',
			assetType: 'stock',
			sector: 'Materials',
			price: null,
			dividendYield: 0.06,
			performance: { changePercent: null },
			fundamentals: {
				priceToEarnings: 6,
				priceToBook: 1.2,
				returnOnEquity: 0.18,
				netMargin: null,
				evEbitda: null,
				marketCap: 200,
			},
			metadata: {
				source: 'fallback_fundamentus',
				fallbackUsed: true,
				partial: true,
				fallbackSources: ['fundamentus'],
			},
		});
		(mockComparisonService.compareAssets as jest.Mock).mockResolvedValue({
			executiveSummary: {
				bestDividendSymbol: 'VALE3',
				bestMomentumSymbol: null,
				bestValuationSymbol: 'VALE3',
				bestFitSymbol: 'VALE3',
			},
			results: [{ fit: { score: 58, status: 'neutral', reasons: [] } }],
			unavailableSymbols: [],
		});

		const response = await service.respond('user-1', 'VALE3');

		expect(response.intent).toBe('external_asset_question');
		expect(
			(response.externalData as any)?.snapshot?.metadata?.fallbackUsed
		).toBe(true);
	});
});
