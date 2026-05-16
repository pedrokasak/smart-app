import { ChatOrchestratorService } from 'src/ai/orchestration/chat-orchestrator.service';
import { ChatCostObserverPort } from 'src/ai/orchestration/chat-cost-observer.port';
import { ChatResponseCachePort } from 'src/ai/orchestration/chat-response-cache.port';
import { UnifiedIntelligenceFacade } from 'src/intelligence/application/unified-intelligence.facade';
import { MarketDataProviderPort } from 'src/market-data/application/market-data-provider.port';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { RiDocumentSummaryService } from 'src/ri-intelligence/application/ri-document-summary.service';
import { RiDocumentQueryPort } from 'src/ri-intelligence/application/ri-document-query.port';

describe('ChatOrchestratorService', () => {
	const mockPortfolioService = {
		getUserPortfolios: jest.fn(),
	} as unknown as PortfolioService;

	const mockUnifiedFacade = {
		getPortfolioSummary: jest.fn(),
		getPortfolioRiskAnalysis: jest.fn(),
		analyzeAssetFit: jest.fn(),
		compareAssets: jest.fn(),
		simulateSell: jest.fn(),
		detectOpportunities: jest.fn(),
		simulateFuture: jest.fn(),
		getTrackerrScore: jest.fn(),
	} as unknown as UnifiedIntelligenceFacade;

	const mockMarketDataProvider: MarketDataProviderPort = {
		getAssetSnapshot: jest.fn(),
		getManyAssetSnapshots: jest.fn(),
	};

	const mockResponseCache: ChatResponseCachePort<any> = {
		get: jest.fn().mockResolvedValue(null),
		set: jest.fn().mockResolvedValue(undefined),
	};

	const mockCostObserver: ChatCostObserverPort = {
		record: jest.fn(),
	};

	const mockRiDocumentSummaryService = {
		summarize: jest.fn(),
	} as unknown as RiDocumentSummaryService;

	const mockRiDocumentQuery: RiDocumentQueryPort = {
		getLatestByTicker: jest.fn(),
		getPreviousComparable: jest.fn(),
	};

	const makeService = () =>
		new ChatOrchestratorService(
			mockPortfolioService,
			mockUnifiedFacade,
			mockMarketDataProvider,
			mockResponseCache,
			mockCostObserver,
			mockRiDocumentSummaryService,
			mockRiDocumentQuery
		);

	beforeEach(() => {
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
					{
						symbol: 'XPLG11',
						type: 'fii',
						quantity: 5,
						total: 500,
						price: 100,
						sector: 'Logistics',
					},
				],
			},
		]);
		(mockUnifiedFacade.getTrackerrScore as jest.Mock).mockReturnValue({
			modelVersion: 'trackerr_score_v1',
			overall: 61,
			weights: {
				quality: 0.24,
				risk: 0.24,
				valuation: 0.2,
				fiscal: 0.16,
				portfolio_fit: 0.16,
			},
			pillars: [],
			explanation: {
				topPositiveDrivers: [],
				topNegativeDrivers: [],
			},
		});
	});

	afterEach(() => jest.clearAllMocks());

	it('routes portfolio summary intent deterministically', async () => {
		(mockUnifiedFacade.getPortfolioSummary as jest.Mock).mockReturnValue({
			totalValue: 1500,
			positionsCount: 2,
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Resumo da minha carteira'
		);

		expect(response.intent).toBe('portfolio_summary');
		expect(response.route).toEqual(
			expect.objectContaining({
				type: 'deterministic_no_llm',
				llmEligible: false,
				reason: 'rules_resolved',
			})
		);
		expect(response.data.portfolioSummary).toEqual(
			expect.objectContaining({ totalValue: 1500 })
		);
		expect(mockUnifiedFacade.getPortfolioSummary).toHaveBeenCalled();
		expect(mockResponseCache.get).toHaveBeenCalled();
		expect(mockResponseCache.set).toHaveBeenCalled();
	});

	it('routes risk intent deterministically', async () => {
		(mockUnifiedFacade.getPortfolioRiskAnalysis as jest.Mock).mockReturnValue({
			risk: { score: 66 },
			concentrationByAsset: [
				{ key: 'ITUB4', symbol: 'ITUB4', percentage: 66.67, severity: 'high' },
			],
			concentrationBySector: [
				{ key: 'Financial', percentage: 66.67, severity: 'high' },
			],
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Minha carteira está muito concentrada?'
		);

		expect(response.intent).toBe('portfolio_risk');
		expect(response.route.type).toBe('deterministic_no_llm');
		expect(response.data.portfolioRisk).toEqual(
			expect.objectContaining({ risk: { score: 66 } })
		);
		expect((response.data.rebalanceSuggestion as any)?.modelVersion).toBe(
			'profile_rebalance_suggestion_v1'
		);
		expect((response.data.rebalanceSuggestion as any)?.riskScore?.targetReductionPct).toBe(20);
		expect(
			Array.isArray((response.data.rebalanceSuggestion as any)?.targetAllocationMix)
		).toBe(true);
		expect(
			(response.data.rebalanceSuggestion as any)?.targetAllocationMix?.[0]
		).toEqual(
			expect.objectContaining({
				bucket: expect.any(String),
				targetPct: expect.any(Number),
			})
		);
		expect(response.assumptions).toEqual(
			expect.arrayContaining([
				'rebalance_suggestion_profile_estimate:conservador',
			])
		);
	});

	it('includes explicit owned assets list in portfolio summary response', async () => {
		(mockUnifiedFacade.getPortfolioSummary as jest.Mock).mockReturnValue({
			totalValue: 1500,
			positionsCount: 2,
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'listar ativos da minha carteira'
		);

		expect(response.intent).toBe('portfolio_summary');
		expect(Array.isArray((response.data as any)?.portfolioAssets)).toBe(true);
		expect((response.data as any)?.portfolioAssets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					symbol: 'ITUB4',
					allocationPct: expect.any(Number),
				}),
				expect.objectContaining({
					symbol: 'XPLG11',
					allocationPct: expect.any(Number),
				}),
			])
		);
	});

	it('classifies rebalance question as portfolio_risk and returns deterministic suggestion', async () => {
		(mockUnifiedFacade.getPortfolioRiskAnalysis as jest.Mock).mockReturnValue({
			risk: { score: 70 },
			concentrationByAsset: [
				{ key: 'ITUB4', symbol: 'ITUB4', percentage: 66, severity: 'high' },
			],
			concentrationBySector: [
				{ key: 'Financial', percentage: 66, severity: 'high' },
			],
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'como balancear minha carteira?'
		);

		expect(response.intent).toBe('portfolio_risk');
		expect(response.route.type).toBe('deterministic_no_llm');
		expect((response.data.rebalanceSuggestion as any)?.actions?.length).toBeGreaterThan(0);
	});

	it('returns cache hit when same deterministic question is repeated', async () => {
		const cachedResponse = {
			intent: 'portfolio_summary',
			deterministic: true,
			route: {
				type: 'deterministic_no_llm',
				llmEligible: false,
				reason: 'rules_resolved',
			},
			cache: { key: 'cached', hit: false, ttlSeconds: 120 },
			cost: {
				llmCalls: 0,
				tokenUsageEstimate: 0,
				estimatedLlmCallsAvoidedByCache: 0,
			},
			question: 'resumo da carteira',
			context: {
				mentionedSymbols: [],
				ownedSymbols: [],
				externalSymbols: [],
				positionsCount: 2,
			},
			data: { portfolioSummary: { totalValue: 1500 } },
			unavailable: [],
			warnings: [],
			assumptions: [],
		};
		(mockResponseCache.get as jest.Mock).mockResolvedValueOnce(
			cachedResponse as any
		);

		const service = makeService();
		const response = await service.orchestrate('user-1', 'Resumo da carteira');

		expect(response.cache.hit).toBe(true);
		expect(mockUnifiedFacade.getPortfolioSummary).not.toHaveBeenCalled();
	});

	it('invalidates cache when portfolio context changes', async () => {
		(mockUnifiedFacade.getPortfolioSummary as jest.Mock).mockReturnValue({
			totalValue: 1500,
			positionsCount: 2,
		});
		const service = makeService();

		await service.orchestrate('user-1', 'Resumo da carteira');
		const firstKey = (mockResponseCache.get as jest.Mock).mock.calls[0][0];

		(mockPortfolioService.getUserPortfolios as jest.Mock).mockResolvedValueOnce(
			[
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
						{
							symbol: 'XPLG11',
							type: 'fii',
							quantity: 5,
							total: 500,
							price: 100,
							sector: 'Logistics',
						},
						{
							symbol: 'PETR4',
							type: 'stock',
							quantity: 1,
							total: 300,
							price: 300,
							sector: 'Energy',
						},
					],
				},
			]
		);

		await service.orchestrate('user-1', 'Resumo da carteira');
		const secondKey = (mockResponseCache.get as jest.Mock).mock.calls[1][0];

		expect(secondKey).not.toBe(firstKey);
	});

	it('invalidates cache when market data version changes for market-sensitive flow', async () => {
		(mockUnifiedFacade.compareAssets as jest.Mock).mockResolvedValue({
			results: [{ symbol: 'ITUB4' }, { symbol: 'PETR4' }],
			unavailableSymbols: [],
		});
		const service = makeService();

		await service.orchestrate('user-1', 'Compare ITUB4 vs PETR4', {
			marketDataVersion: 'v1',
		});
		const firstKey = (mockResponseCache.get as jest.Mock).mock.calls[0][0];

		await service.orchestrate('user-1', 'Compare ITUB4 vs PETR4', {
			marketDataVersion: 'v2',
		});
		const secondKey = (mockResponseCache.get as jest.Mock).mock.calls[1][0];

		expect(secondKey).not.toBe(firstKey);
	});

	it('falls back safely when cache backend is unavailable', async () => {
		(mockResponseCache.get as jest.Mock).mockRejectedValueOnce(
			new Error('cache down')
		);
		(mockUnifiedFacade.getPortfolioSummary as jest.Mock).mockReturnValue({
			totalValue: 1500,
			positionsCount: 2,
		});

		const service = makeService();
		const response = await service.orchestrate('user-1', 'Resumo da carteira');

		expect(response.warnings).toEqual(
			expect.arrayContaining(['chat_cache_unavailable'])
		);
		expect(response.data.portfolioSummary).toBeDefined();
	});

	it('routes comparison intent and includes owned/external symbols', async () => {
		(mockUnifiedFacade.compareAssets as jest.Mock).mockResolvedValue({
			executiveSummary: {
				bestDividendSymbol: 'ITUB4',
				bestMomentumSymbol: 'PETR4',
				bestValuationSymbol: 'ITUB4',
				bestFitSymbol: 'ITUB4',
			},
			byDimension: {
				quote: [],
				fundamentals: [],
				dividends: [],
				performance: [],
			},
			results: [
				{
					symbol: 'ITUB4',
					inPortfolio: true,
					fit: {
						classification: 'bom',
						portfolioImpact: {
							diversification: { deltaScore: 1.5 },
						},
					},
				},
				{
					symbol: 'PETR4',
					inPortfolio: false,
					fit: {
						classification: 'neutro',
						portfolioImpact: {
							diversification: { deltaScore: 0.2 },
						},
					},
				},
			],
			unavailableSymbols: [],
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Compare ITUB4 vs PETR4'
		);

		expect(response.intent).toBe('asset_comparison');
		expect(response.route.type).toBe('deterministic_no_llm');
		expect(response.route.llmEligible).toBe(false);
		expect(response.context.ownedSymbols).toEqual(['ITUB4']);
		expect(response.context.externalSymbols).toEqual(['PETR4']);
		expect(
			(response.data.comparison as any)?.executiveSummary?.bestDividendSymbol
		).toBe('ITUB4');
		expect(
			(response.data.comparison as any)?.results?.find(
				(item: any) => item.symbol === 'ITUB4'
			)?.fit?.classification
		).toBe('bom');
	});

	it('keeps comparison safe when provider data is partial', async () => {
		(mockUnifiedFacade.compareAssets as jest.Mock).mockResolvedValue({
			executiveSummary: {
				bestDividendSymbol: 'PETR4',
				bestMomentumSymbol: null,
				bestValuationSymbol: null,
				bestFitSymbol: 'PETR4',
			},
			byDimension: {
				quote: [],
				fundamentals: [],
				dividends: [],
				performance: [],
			},
			results: [
				{
					symbol: 'PETR4',
					inPortfolio: false,
					dataQuality: {
						partial: true,
						fallbackUsed: true,
						fallbackSources: ['fundamentus'],
						missingMetrics: ['price'],
					},
					fit: {
						classification: 'neutro',
					},
				},
			],
			unavailableSymbols: ['ABCD3'],
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Compare PETR4 e ABCD3'
		);

		expect(response.intent).toBe('asset_comparison');
		expect(response.unavailable).toEqual(expect.arrayContaining(['ABCD3']));
		expect(
			(response.data.comparison as any)?.results?.[0]?.dataQuality?.partial
		).toBe(true);
	});

	it('routes sell simulation using owned asset and market data price', async () => {
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue({
			symbol: 'ITUB4',
			assetType: 'stock',
			sector: 'Financial',
			price: 120,
			dividendYield: 0.07,
			performance: { changePercent: 1.2 },
			fundamentals: {
				priceToEarnings: 8,
				priceToBook: 1,
				returnOnEquity: 0.2,
				netMargin: 0.2,
				evEbitda: 4,
				marketCap: 10,
			},
			metadata: {
				source: 'primary',
				fallbackUsed: false,
				partial: false,
				fallbackSources: [],
			},
		});
		(mockUnifiedFacade.simulateSell as jest.Mock).mockReturnValue({
			symbol: 'ITUB4',
			estimatedTax: 15,
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Simular venda de ITUB4'
		);

		expect(response.intent).toBe('sell_simulation');
		expect(response.route.type).toBe('deterministic_no_llm');
		expect(response.data.sellSimulation).toEqual(
			expect.objectContaining({ estimatedTax: 15 })
		);
		expect(response.assumptions).toEqual(
			expect.arrayContaining(['sell_quantity_defaulted_to_full_position'])
		);
	});

	it('reports clearly when asset is not in portfolio for sell simulation', async () => {
		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Simular venda de PETR4'
		);

		expect(response.intent).toBe('sell_simulation');
		expect(response.route.reason).toBe('insufficient_structured_data');
		expect(response.unavailable).toEqual(['PETR4']);
		expect(response.warnings).toEqual(
			expect.arrayContaining(['sell_simulation_requires_owned_asset'])
		);
	});

	it('routes external asset analysis and flags ownership status', async () => {
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue({
			symbol: 'PETR4',
			assetType: 'stock',
			sector: 'Energy',
			price: 30,
			dividendYield: 0.1,
			performance: { changePercent: 0.8 },
			fundamentals: {
				priceToEarnings: 5,
				priceToBook: 1,
				returnOnEquity: 0.2,
				netMargin: 0.15,
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

		const service = makeService();
		const response = await service.orchestrate('user-1', 'PETR4 vale a pena?');

		expect(response.intent).toBe('external_asset_analysis');
		expect(response.route.type).toBe('deterministic_no_llm');
		expect(response.data.externalAsset).toBeDefined();
		expect(response.warnings).toEqual(
			expect.arrayContaining(['asset_not_in_portfolio'])
		);
	});

	it('detects asset as owned when it exists in portfolio context', async () => {
		(mockPortfolioService.getUserPortfolios as jest.Mock).mockResolvedValueOnce(
			[
				{
					assets: [
						{
							symbol: 'PETR4',
							type: 'stock',
							quantity: 10,
							total: 300,
							price: 30,
							sector: 'Energy',
						},
					],
				},
			]
		);
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue({
			symbol: 'PETR4',
			assetType: 'stock',
			sector: 'Energy',
			price: 30,
			dividendYield: 0.1,
			performance: { changePercent: 0.8 },
			fundamentals: {
				priceToEarnings: 5,
				priceToBook: 1,
				returnOnEquity: 0.2,
				netMargin: 0.15,
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

		const service = makeService();
		const response = await service.orchestrate('user-1', 'PETR4 vale a pena?');

		expect(response.context.ownedSymbols).toEqual(['PETR4']);
		expect(response.context.externalSymbols).toEqual([]);
		expect(response.warnings).toEqual(
			expect.arrayContaining(['asset_is_in_portfolio'])
		);
		expect(response.warnings).not.toEqual(
			expect.arrayContaining(['asset_not_in_portfolio'])
		);
	});

	it('normalizes ticker between portfolio and chat question', async () => {
		(mockPortfolioService.getUserPortfolios as jest.Mock).mockResolvedValueOnce(
			[
				{
					assets: [
						{
							symbol: 'petr4.sa',
							type: 'stock',
							quantity: 10,
							total: 300,
							price: 30,
							sector: 'Energy',
						},
					],
				},
			]
		);
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue({
			symbol: 'PETR4',
			assetType: 'stock',
			sector: 'Energy',
			price: 30,
			dividendYield: 0.1,
			performance: { changePercent: 0.8 },
			fundamentals: {
				priceToEarnings: 5,
				priceToBook: 1,
				returnOnEquity: 0.2,
				netMargin: 0.15,
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
		(mockUnifiedFacade.simulateSell as jest.Mock).mockReturnValue({
			symbol: 'PETR4',
			estimatedTax: 12,
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Simular venda de PETR4'
		);

		expect(response.intent).toBe('sell_simulation');
		expect(response.route.reason).toBe('rules_resolved');
		expect(response.unavailable).toEqual([]);
		expect(response.warnings).not.toEqual(
			expect.arrayContaining(['sell_simulation_requires_owned_asset'])
		);
		expect(mockUnifiedFacade.simulateSell).toHaveBeenCalledWith(
			expect.objectContaining({ symbol: 'PETR4' })
		);
	});

	it('keeps external asset analysis safe when fallback data is partial', async () => {
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue({
			symbol: 'PETR4',
			assetType: 'stock',
			sector: null,
			price: null,
			dividendYield: 0.1,
			performance: { changePercent: null },
			fundamentals: {
				priceToEarnings: 5,
				priceToBook: null,
				returnOnEquity: 0.2,
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
		});
		(mockUnifiedFacade.analyzeAssetFit as jest.Mock).mockReturnValue({
			classification: 'neutro',
			signals: ['candidate_value_estimated_from_price'],
		});

		const service = makeService();
		const response = await service.orchestrate('user-1', 'PETR4 vale a pena?');

		expect(response.intent).toBe('external_asset_analysis');
		expect(response.route.type).toBe('deterministic_no_llm');
		expect(response.warnings).toEqual(
			expect.arrayContaining([
				'asset_not_in_portfolio',
				'external_asset_data_partial',
				'external_asset_data_from_fallback',
				'portfolio_fit_with_partial_candidate_value',
				'external_asset_sector_unavailable',
			])
		);
		expect((response.data.externalAsset as any)?.metadata?.source).toBe(
			'fallback_fundamentus'
		);
	});

	it('routes fit analysis and degrades safely when external data is missing', async () => {
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue(
			null
		);

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'PETR4 faz sentido para minha carteira?'
		);

		expect(response.intent).toBe('portfolio_fit_analysis');
		expect(response.route.reason).toBe('insufficient_structured_data');
		expect(response.unavailable).toEqual(['PETR4']);
		expect(response.warnings).toEqual(
			expect.arrayContaining(['external_asset_data_unavailable'])
		);
	});

	it('degrades safely when portfolio context is absent', async () => {
		(mockPortfolioService.getUserPortfolios as jest.Mock).mockResolvedValueOnce(
			[]
		);
		(mockUnifiedFacade.getPortfolioSummary as jest.Mock).mockReturnValue({
			totalValue: 0,
			positionsCount: 0,
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Resumo da minha carteira'
		);

		expect(response.intent).toBe('portfolio_summary');
		expect(response.context.positionsCount).toBe(0);
		expect(response.context.ownedSymbols).toEqual([]);
		expect(response.data.portfolioSummary).toEqual(
			expect.objectContaining({ totalValue: 0, positionsCount: 0 })
		);
	});

	it('routes complex narrative question to synthesis layer', async () => {
		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Explique a estratégia ideal da minha carteira para os próximos 5 anos'
		);

		expect(response.intent).toBe('narrative_synthesis');
		expect(response.route).toEqual(
			expect.objectContaining({
				type: 'synthesis_required',
				llmEligible: true,
				reason: 'narrative_requested',
			})
		);
	});

	it('routes tax estimation deterministically for owned asset', async () => {
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue({
			symbol: 'ITUB4',
			assetType: 'stock',
			sector: 'Financial',
			price: 130,
			dividendYield: 0.08,
			performance: { changePercent: 1.2 },
			fundamentals: {
				priceToEarnings: 8,
				priceToBook: 1,
				returnOnEquity: 0.2,
				netMargin: 0.2,
				evEbitda: 4,
				marketCap: 10,
			},
			metadata: {
				source: 'primary',
				fallbackUsed: false,
				partial: false,
				fallbackSources: [],
			},
		});
		(mockUnifiedFacade.simulateSell as jest.Mock).mockReturnValue({
			symbol: 'ITUB4',
			estimatedTax: 25,
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Quanto imposto pago em ITUB4?'
		);

		expect(response.intent).toBe('tax_estimation');
		expect(response.route.type).toBe('deterministic_no_llm');
		expect(response.data.sellSimulation).toEqual(
			expect.objectContaining({ estimatedTax: 25 })
		);
		expect(response.assumptions).toEqual(
			expect.arrayContaining(['tax_estimation_assumes_full_position_sell'])
		);
	});

	it('supports partial sell simulation when question requests half position', async () => {
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue({
			symbol: 'ITUB4',
			assetType: 'stock',
			sector: 'Financial',
			price: 130,
			dividendYield: 0.08,
			performance: { changePercent: 1.2 },
			fundamentals: {
				priceToEarnings: 8,
				priceToBook: 1,
				returnOnEquity: 0.2,
				netMargin: 0.2,
				evEbitda: 4,
				marketCap: 10,
			},
			metadata: {
				source: 'primary',
				fallbackUsed: false,
				partial: false,
				fallbackSources: [],
			},
		});
		(mockUnifiedFacade.simulateSell as jest.Mock).mockReturnValue({
			symbol: 'ITUB4',
			realizedPnl: 50,
			estimatedTax: 7.5,
			remainingQuantity: 5,
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'E se eu vender metade de ITUB4?'
		);

		expect(response.intent).toBe('sell_simulation');
		expect(mockUnifiedFacade.simulateSell).toHaveBeenCalledWith(
			expect.objectContaining({
				symbol: 'ITUB4',
				quantityToSell: 5,
			})
		);
		expect(response.assumptions).toEqual(
			expect.arrayContaining(['sell_quantity_interpreted_as_half_position'])
		);
	});

	it('supports partial tax estimation when question requests half position', async () => {
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue({
			symbol: 'ITUB4',
			assetType: 'stock',
			sector: 'Financial',
			price: 130,
			dividendYield: 0.08,
			performance: { changePercent: 1.2 },
			fundamentals: {
				priceToEarnings: 8,
				priceToBook: 1,
				returnOnEquity: 0.2,
				netMargin: 0.2,
				evEbitda: 4,
				marketCap: 10,
			},
			metadata: {
				source: 'primary',
				fallbackUsed: false,
				partial: false,
				fallbackSources: [],
			},
		});
		(mockUnifiedFacade.simulateSell as jest.Mock).mockReturnValue({
			symbol: 'ITUB4',
			realizedPnl: 120,
			estimatedTax: 18,
			remainingQuantity: 5,
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Quanto imposto para metade da posição em ITUB4?'
		);

		expect(response.intent).toBe('tax_estimation');
		expect(mockUnifiedFacade.simulateSell).toHaveBeenCalledWith(
			expect.objectContaining({
				symbol: 'ITUB4',
				quantityToSell: 5,
			})
		);
		expect(response.assumptions).toEqual(
			expect.arrayContaining(['tax_estimation_assumes_half_position_sell'])
		);
	});

	it('returns lucro scenario from tax engine output', async () => {
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue({
			symbol: 'ITUB4',
			assetType: 'stock',
			sector: 'Financial',
			price: 140,
			dividendYield: 0.08,
			performance: { changePercent: 1.2 },
			fundamentals: {
				priceToEarnings: 8,
				priceToBook: 1,
				returnOnEquity: 0.2,
				netMargin: 0.2,
				evEbitda: 4,
				marketCap: 10,
			},
			metadata: {
				source: 'primary',
				fallbackUsed: false,
				partial: false,
				fallbackSources: [],
			},
		});
		(mockUnifiedFacade.simulateSell as jest.Mock).mockReturnValue({
			symbol: 'ITUB4',
			realizedPnl: 300,
			estimatedTax: 45,
			classification: 'tributavel',
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Quanto imposto pago em ITUB4?'
		);

		expect((response.data.sellSimulation as any)?.realizedPnl).toBe(300);
		expect((response.data.sellSimulation as any)?.classification).toBe(
			'tributavel'
		);
	});

	it('returns prejuizo scenario from tax engine output', async () => {
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue({
			symbol: 'ITUB4',
			assetType: 'stock',
			sector: 'Financial',
			price: 80,
			dividendYield: 0.08,
			performance: { changePercent: -1.2 },
			fundamentals: {
				priceToEarnings: 8,
				priceToBook: 1,
				returnOnEquity: 0.2,
				netMargin: 0.2,
				evEbitda: 4,
				marketCap: 10,
			},
			metadata: {
				source: 'primary',
				fallbackUsed: false,
				partial: false,
				fallbackSources: [],
			},
		});
		(mockUnifiedFacade.simulateSell as jest.Mock).mockReturnValue({
			symbol: 'ITUB4',
			realizedPnl: -120,
			estimatedTax: 0,
			classification: 'isento',
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Quanto imposto pago em ITUB4?'
		);

		expect((response.data.sellSimulation as any)?.realizedPnl).toBe(-120);
		expect((response.data.sellSimulation as any)?.estimatedTax).toBe(0);
	});

	it('returns compensacao scenario from tax engine output', async () => {
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue({
			symbol: 'ITUB4',
			assetType: 'stock',
			sector: 'Financial',
			price: 130,
			dividendYield: 0.08,
			performance: { changePercent: 1.2 },
			fundamentals: {
				priceToEarnings: 8,
				priceToBook: 1,
				returnOnEquity: 0.2,
				netMargin: 0.2,
				evEbitda: 4,
				marketCap: 10,
			},
			metadata: {
				source: 'primary',
				fallbackUsed: false,
				partial: false,
				fallbackSources: [],
			},
		});
		(mockUnifiedFacade.simulateSell as jest.Mock).mockReturnValue({
			symbol: 'ITUB4',
			realizedPnl: 300,
			taxableBaseAfterCompensation: 50,
			compensationUsed: 250,
			estimatedTax: 7.5,
			classification: 'tributavel_com_compensacao',
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Quanto imposto pago em ITUB4?'
		);

		expect((response.data.sellSimulation as any)?.compensationUsed).toBe(250);
		expect((response.data.sellSimulation as any)?.classification).toBe(
			'tributavel_com_compensacao'
		);
	});

	it('degrades safely when compensation history is insufficient', async () => {
		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Tenho prejuízo compensável?'
		);

		expect(response.intent).toBe('tax_estimation');
		expect(response.route.reason).toBe('insufficient_structured_data');
		expect(response.warnings).toEqual(
			expect.arrayContaining(['insufficient_history_for_loss_compensation'])
		);
		expect(mockUnifiedFacade.simulateSell).not.toHaveBeenCalled();
	});

	it('routes opportunity radar deterministically', async () => {
		(mockUnifiedFacade.detectOpportunities as jest.Mock).mockResolvedValue({
			modelVersion: 'opportunity_radar_v1',
			opportunities: [{ symbol: 'BBAS3', type: 'attractive_range' }],
			underallocatedSectors: [],
			signals: [
				{
					id: 'opportunity:bbas3',
					symbol: 'BBAS3',
					kind: 'opportunity',
					priority: 'high',
					score: 80,
					title: 'BBAS3 em faixa atrativa',
					details: ['Preço e valuation em faixa.'],
				},
			],
			unavailableSymbols: [],
			warnings: [],
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Quais oportunidades existem hoje na minha carteira?'
		);

		expect(response.intent).toBe('opportunity_radar');
		expect(response.route.type).toBe('deterministic_no_llm');
		expect((response.data.opportunities as any)?.modelVersion).toBe(
			'opportunity_radar_v1'
		);
	});

	it('routes future scenario deterministically with dividend projection', async () => {
		(mockUnifiedFacade.simulateFuture as jest.Mock).mockReturnValue({
			modelVersion: 'future_simulator_v1',
			horizon: '5y',
			months: 60,
			currentPortfolioValue: 1500,
			monthlyContribution: 0,
			scenarios: {
				pessimistic: {
					projectedValue: 1800,
					projectedDividendFlow: { monthly: 20, annual: 240 },
				},
				base: {
					projectedValue: 2200,
					projectedDividendFlow: { monthly: 30, annual: 360 },
				},
				optimistic: {
					projectedValue: 2700,
					projectedDividendFlow: { monthly: 40, annual: 480 },
				},
			},
			dividendProjection: {
				modelVersion: 'deterministic_dividend_projection_v1',
				current: { monthly: 15, annual: 180 },
				scenarios: {
					pessimistic: { monthly: 20, annual: 240 },
					base: { monthly: 30, annual: 360 },
					optimistic: { monthly: 40, annual: 480 },
				},
				coverage: {
					positionsWithData: 1,
					positionsWithoutData: 1,
					dataCoveragePct: 50,
				},
				confidence: 'medium',
			},
			assumptions: {
				contributionFrequency: 'monthly',
				scenarioReturnsAnnualPct: {
					pessimistic: 0.02,
					base: 0.08,
					optimistic: 0.14,
				},
			},
			limitations: [],
			confidence: 'high',
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Quanto minha carteira pode valer em 5 anos?'
		);

		expect(response.intent).toBe('future_scenario');
		expect(response.route.type).toBe('deterministic_no_llm');
		expect((response.data.futureSimulation as any)?.horizon).toBe('5y');
		expect(
			(response.data.dividendProjection as any)?.scenarios?.base?.annual
		).toBe(360);
	});

	it('routes RI summary and degrades safely when missing document', async () => {
		(mockRiDocumentQuery.getLatestByTicker as jest.Mock).mockResolvedValue(
			null
		);

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'O que mudou no último RI de BBDC4?'
		);

		expect(response.intent).toBe('ri_summary');
		expect(response.route.reason).toBe('insufficient_structured_data');
		expect(response.warnings).toEqual(
			expect.arrayContaining(['ri_document_not_found'])
		);
	});

	it('routes RI comparison deterministically when current and previous docs are available', async () => {
		(mockRiDocumentQuery.getLatestByTicker as jest.Mock).mockResolvedValue({
			document: {
				id: 'doc-current',
				ticker: 'BBDC4',
				company: 'Bradesco',
				title: '4T25',
				documentType: 'earnings_release',
				period: '4T25',
				publishedAt: '2026-02-10T00:00:00.000Z',
				source: { type: 'url', value: 'https://example.com/current.pdf' },
				classification: { method: 'provided', confidence: 'high' },
				contentStatus: 'metadata_only',
			},
			content:
				'receita crescimento lucro alta guidance otimista riscos controle',
		});
		(mockRiDocumentQuery.getPreviousComparable as jest.Mock).mockResolvedValue({
			document: {
				id: 'doc-prev',
				ticker: 'BBDC4',
				company: 'Bradesco',
				title: '3T25',
				documentType: 'earnings_release',
				period: '3T25',
				publishedAt: '2025-11-10T00:00:00.000Z',
				source: { type: 'url', value: 'https://example.com/prev.pdf' },
				classification: { method: 'provided', confidence: 'high' },
				contentStatus: 'metadata_only',
			},
			content: 'receita queda lucro queda guidance conservador riscos aumento',
		});
		(mockRiDocumentSummaryService.summarize as jest.Mock)
			.mockResolvedValueOnce({
				document: {
					id: 'doc-current',
					ticker: 'BBDC4',
					company: 'Bradesco',
					documentType: 'earnings_release',
					period: '4T25',
					publishedAt: '2026-02-10T00:00:00.000Z',
				},
				summary: {
					status: 'ai_generated',
					highlights: [],
					narrative: null,
					limitations: [],
					sourceLabel: 'ai_summary',
				},
				structuredSignals: {
					revenue: { detected: true, direction: 'up', evidence: [] },
					profit: { detected: true, direction: 'up', evidence: [] },
					margin: { detected: true, direction: 'neutral', evidence: [] },
					indebtedness: { detected: false, direction: 'unknown', evidence: [] },
					capex: { detected: true, direction: 'up', evidence: [] },
					guidance: { detected: true, direction: 'up', evidence: [] },
					risks: { detected: true, direction: 'down', evidence: [] },
					toneShift: { detected: true, direction: 'up', evidence: [] },
				},
				cache: { key: null, hit: false, ttlSeconds: null },
				cost: { aiCalls: 1, tokenUsageEstimate: 100 },
			})
			.mockResolvedValueOnce({
				document: {
					id: 'doc-prev',
					ticker: 'BBDC4',
					company: 'Bradesco',
					documentType: 'earnings_release',
					period: '3T25',
					publishedAt: '2025-11-10T00:00:00.000Z',
				},
				summary: {
					status: 'ai_generated',
					highlights: [],
					narrative: null,
					limitations: [],
					sourceLabel: 'ai_summary',
				},
				structuredSignals: {
					revenue: { detected: true, direction: 'down', evidence: [] },
					profit: { detected: true, direction: 'down', evidence: [] },
					margin: { detected: true, direction: 'neutral', evidence: [] },
					indebtedness: { detected: false, direction: 'unknown', evidence: [] },
					capex: { detected: true, direction: 'down', evidence: [] },
					guidance: { detected: true, direction: 'down', evidence: [] },
					risks: { detected: true, direction: 'up', evidence: [] },
					toneShift: { detected: true, direction: 'down', evidence: [] },
				},
				cache: { key: null, hit: false, ttlSeconds: null },
				cost: { aiCalls: 1, tokenUsageEstimate: 100 },
			});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'Compare o RI atual com o anterior de BBDC4'
		);

		expect(response.intent).toBe('ri_comparison');
		expect(response.route.type).toBe('deterministic_no_llm');
		expect((response.data.riComparison as any)?.status).toBe('compared');
		expect((response.data.riComparison as any)?.differences?.guidance).toBe(
			'improved'
		);
		expect((response.data.riComparison as any)?.differences?.capex).toBe(
			'improved'
		);
		expect((response.data.riTimeline as any[] | undefined)?.length).toBe(2);
		expect((response.data.riComparison as any)?.materialAlerts).toEqual(
			expect.arrayContaining([
				expect.stringContaining('Capex mudou de down para up'),
			])
		);
		expect((response.data.riComparison as any)?.differences?.keyChanges?.capex)
			.toEqual({ from: 'down', to: 'up' });
	});

	it('routes committee flow and returns weekly briefing structure', async () => {
		(mockUnifiedFacade.getPortfolioSummary as jest.Mock).mockReturnValue({
			totalValue: 1500,
			positionsCount: 2,
		});
		(mockUnifiedFacade.getPortfolioRiskAnalysis as jest.Mock).mockReturnValue({
			risk: { score: 62, flags: [{severity: 'high', message: 'Risco alto'}] },
			concentrationByAsset: [{key: 'ITUB4', percentage: 42, severity: 'high'}],
			concentrationBySector: [],
			rebalanceSuggestionInputs: {},
		});
		(mockUnifiedFacade.detectOpportunities as jest.Mock).mockResolvedValue({
			opportunities: [],
			signals: [],
			unavailableSymbols: [],
			warnings: [],
		});
		(mockMarketDataProvider.getManyAssetSnapshots as jest.Mock).mockResolvedValue([
			{
				symbol: 'ITUB4',
				assetType: 'stock',
				sector: 'Financial',
				price: 30,
				dividendYield: 0.08,
				performance: {changePercent: 1},
				fundamentals: {
					priceToEarnings: 8,
					priceToBook: 1,
					returnOnEquity: 0.2,
					netMargin: 0.18,
					evEbitda: 5,
					marketCap: 100,
				},
				metadata: {source: 'primary', fallbackUsed: false, partial: false, fallbackSources: []},
			},
		]);

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'gerar briefing semanal',
			{copilotFlow: 'committee_mode'},
		);

		expect(response.intent).toBe('investment_committee');
		expect((response.data.investmentCommittee as any)?.modelVersion).toBe(
			'investment_committee_v1',
		);
		expect((response.data.investmentCommittee as any)?.objectivePlan?.length).toBeGreaterThan(0);
	});

	it('supports guided reduce_risk flow with deterministic target override', async () => {
		(mockUnifiedFacade.getPortfolioRiskAnalysis as jest.Mock).mockReturnValue({
			risk: { score: 80, flags: [] },
			concentrationByAsset: [{ key: 'ITUB4', symbol: 'ITUB4', severity: 'high' }],
			concentrationBySector: [{ key: 'Financial', severity: 'high' }],
		});

		const service = makeService();
		const response = await service.orchestrate(
			'user-1',
			'reduzir risco',
			{
				copilotFlow: 'reduce_risk_20',
				decisionFlow: {
					action: 'reduce_risk',
					targetRiskReductionPct: 25,
				},
			}
		);

		expect(response.intent).toBe('portfolio_risk');
		expect((response.data.rebalancePlan as any)?.targetRiskReductionPct).toBe(25);
		expect((response.data.rebalancePlan as any)?.targetRiskScore).toBe(60);
		expect(response.route.type).toBe('deterministic_no_llm');
	});

	it('returns pre and post trade fiscal details in sell guided flow', async () => {
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue({
			symbol: 'ITUB4',
			assetType: 'stock',
			sector: 'Financial',
			price: 130,
			dividendYield: 0.08,
			performance: { changePercent: 1.2 },
			fundamentals: {
				priceToEarnings: 8,
				priceToBook: 1,
				returnOnEquity: 0.2,
				netMargin: 0.2,
				evEbitda: 4,
				marketCap: 10,
			},
			metadata: {
				source: 'primary',
				fallbackUsed: false,
				partial: false,
				fallbackSources: [],
			},
		});
		(mockUnifiedFacade.simulateSell as jest.Mock).mockReturnValue({
			symbol: 'ITUB4',
			estimatedTax: 30,
			taxRateApplied: 0.15,
			realizedPnl: 200,
			remainingQuantity: 5,
			compensationUsed: 0,
			monthlyExemptionApplied: false,
			classification: 'tributavel',
		});

		const service = makeService();
		const response = await service.orchestrate('user-1', 'Simular venda de ITUB4');

		expect(response.intent).toBe('sell_simulation');
		expect((response.data.tradePlaybook as any)?.preTrade?.estimatedTax).toBe(30);
		expect((response.data.tradePlaybook as any)?.preTrade?.taxRateApplied).toBe(15);
		expect((response.data.tradePlaybook as any)?.postTrade?.estimatedDarf).toBe(30);
		expect((response.data.tradePlaybook as any)?.preTrade?.alternatives?.length).toBe(3);
	});
});
