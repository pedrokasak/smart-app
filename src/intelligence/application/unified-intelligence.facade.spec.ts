import { ComparisonEngineService } from 'src/comparison/application/comparison-engine.service';
import { TaxEngineService } from 'src/fiscal/tax-engine/application/tax-engine.service';
import { FutureSimulatorService } from 'src/intelligence/application/future-simulator.service';
import { OpportunityRadarService } from 'src/intelligence/application/opportunity-radar.service';
import { PremiumInsightsService } from 'src/intelligence/application/premium-insights.service';
import { UnifiedIntelligenceFacade } from 'src/intelligence/application/unified-intelligence.facade';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';

describe('UnifiedIntelligenceFacade', () => {
	const mockPortfolioIntelligenceService = {
		analyzePositions: jest.fn(),
		analyzePortfolioFit: jest.fn(),
	} as unknown as PortfolioIntelligenceService;

	const mockComparisonEngineService = {
		compareAssets: jest.fn(),
	} as unknown as ComparisonEngineService;

	const mockTaxEngineService = {
		simulateSaleImpact: jest.fn(),
	} as unknown as TaxEngineService;

	const mockOpportunityRadarService = {
		detect: jest.fn(),
	} as unknown as OpportunityRadarService;

	const mockFutureSimulatorService = {
		simulate: jest.fn(),
	} as unknown as FutureSimulatorService;

	const mockPremiumInsightsService = {
		generate: jest.fn(),
	} as unknown as PremiumInsightsService;

	const makeFacade = () =>
		new UnifiedIntelligenceFacade(
			mockPortfolioIntelligenceService,
			mockComparisonEngineService,
			mockTaxEngineService,
			mockOpportunityRadarService,
			mockFutureSimulatorService,
			mockPremiumInsightsService
		);

	afterEach(() => jest.clearAllMocks());

	it('returns portfolio summary from portfolio intelligence analysis', () => {
		(mockPortfolioIntelligenceService.analyzePositions as jest.Mock).mockReturnValue({
			facts: {
				totalValue: 10000,
				positionsCount: 2,
				allocationByClass: [{ key: 'equities', value: 7000, percentage: 70 }],
				allocationByAsset: [{ key: 'ITUB4', value: 5000, percentage: 50 }],
				allocationByGeography: [{ key: 'BR', value: 10000, percentage: 100 }],
			},
			estimates: {
				diversification: { score: 74, status: 'good' },
				dividendProjection: { projectedAnnualIncome: 800 },
			},
		});

		const facade = makeFacade();
		const output = facade.getPortfolioSummary({
			positions: [],
		});

		expect(output.totalValue).toBe(10000);
		expect(output.positionsCount).toBe(2);
		expect(output.allocationByClass[0].key).toBe('equities');
		expect(output.diversification.score).toBe(74);
	});

	it('returns risk and concentration analysis from portfolio intelligence', () => {
		(mockPortfolioIntelligenceService.analyzePositions as jest.Mock).mockReturnValue({
			facts: {
				concentrationByAsset: [{ key: 'PETR4', percentage: 40, severity: 'high' }],
				concentrationBySector: [{ key: 'ENERGY', percentage: 55, severity: 'high' }],
			},
			estimates: {
				risk: { score: 78, level: 'high' },
				rebalanceSuggestionInputs: { hasRelevantSignals: true },
			},
		});

		const facade = makeFacade();
		const output = facade.getPortfolioRiskAnalysis({
			positions: [],
		});

		expect(output.risk.level).toBe('high');
		expect(output.concentrationByAsset[0].key).toBe('PETR4');
		expect(output.rebalanceSuggestionInputs.hasRelevantSignals).toBe(true);
	});

	it('delegates asset fit analysis to portfolio intelligence engine', () => {
		(mockPortfolioIntelligenceService.analyzePortfolioFit as jest.Mock).mockReturnValue({
			classification: 'bom',
			impact: {
				diversification: { deltaScore: 5 },
				sectorConcentration: { deltaPercentage: -2 },
			},
		});

		const facade = makeFacade();
		const output = facade.analyzeAssetFit({
			positions: [],
			candidate: {
				symbol: 'BTC',
				assetType: 'crypto',
				quantity: 1,
				totalValue: 5000,
				sector: 'Digital Assets',
			},
		});

		expect(output.classification).toBe('bom');
		expect(output.impact.diversification.deltaScore).toBe(5);
	});

	it('delegates asset comparison to comparison engine', async () => {
		(mockComparisonEngineService.compareAssets as jest.Mock).mockResolvedValue({
			executiveSummary: { bestFitSymbol: 'ITUB4' },
			results: [{ symbol: 'ITUB4' }],
			unavailableSymbols: [],
		});

		const facade = makeFacade();
		const output = await facade.compareAssets({
			symbols: ['ITUB4', 'BBAS3'],
			portfolioPositions: [],
		});

		expect(output.executiveSummary.bestFitSymbol).toBe('ITUB4');
		expect(mockComparisonEngineService.compareAssets).toHaveBeenCalledWith({
			symbols: ['ITUB4', 'BBAS3'],
			portfolioPositions: [],
			thresholds: undefined,
		});
	});

	it('delegates sell simulation to tax engine service', () => {
		(mockTaxEngineService.simulateSaleImpact as jest.Mock).mockReturnValue({
			symbol: 'KNCR11',
			averagePrice: 100,
			realizedPnl: 200,
			estimatedTax: 40,
			remainingQuantity: 0,
			classification: 'tributavel',
		});

		const facade = makeFacade();
		const output = facade.simulateSell({
			symbol: 'KNCR11',
			assetType: 'fii',
			quantityToSell: 10,
			sellPrice: 120,
			simulatedSellDate: '2026-03-20',
			currentPosition: {
				quantity: 10,
				totalCost: 1000,
			},
		});

		expect(output.averagePrice).toBe(100);
		expect(output.realizedPnl).toBe(200);
		expect(output.estimatedTax).toBe(40);
		expect(output.classification).toBe('tributavel');
	});

	it('delegates opportunity radar detection', async () => {
		(mockOpportunityRadarService.detect as jest.Mock).mockResolvedValue({
			modelVersion: 'opportunity_radar_v1',
			opportunities: [],
			underallocatedSectors: [],
			signals: [],
			unavailableSymbols: [],
			warnings: [],
		});

		const facade = makeFacade();
		const output = await facade.detectOpportunities({
			portfolioPositions: [],
			candidateSymbols: ['ITUB4'],
		});

		expect(output.modelVersion).toBe('opportunity_radar_v1');
		expect(mockOpportunityRadarService.detect).toHaveBeenCalledWith({
			portfolioPositions: [],
			candidateSymbols: ['ITUB4'],
		});
	});

	it('delegates future simulation to future simulator service', () => {
		(mockFutureSimulatorService.simulate as jest.Mock).mockReturnValue({
			modelVersion: 'future_simulator_v1',
			horizon: '1y',
			months: 12,
			currentPortfolioValue: 10000,
			monthlyContribution: 500,
			scenarios: {
				pessimistic: {
					label: 'pessimistic',
					annualReturnPct: 0.02,
					projectedValue: 16500,
					range: { lower: 14520, upper: 18480 },
				},
				base: {
					label: 'base',
					annualReturnPct: 0.08,
					projectedValue: 17100,
					range: { lower: 15048, upper: 19152 },
				},
				optimistic: {
					label: 'optimistic',
					annualReturnPct: 0.14,
					projectedValue: 17700,
					range: { lower: 15576, upper: 19824 },
				},
			},
			assumptions: {
				contributionFrequency: 'monthly',
				scenarioReturnsAnnualPct: {
					pessimistic: 0.02,
					base: 0.08,
					optimistic: 0.14,
				},
			},
			dividendProjection: {
				modelVersion: 'deterministic_dividend_projection_v1',
				current: { monthly: 10, annual: 120 },
				scenarios: {
					pessimistic: { monthly: 9, annual: 108 },
					base: { monthly: 10, annual: 120 },
					optimistic: { monthly: 11, annual: 132 },
				},
				coverage: {
					positionsWithData: 1,
					positionsWithoutData: 0,
					dataCoveragePct: 100,
				},
				confidence: 'high',
			},
			limitations: [],
			confidence: 'high',
		});

		const facade = makeFacade();
		const output = facade.simulateFuture({
			positions: [],
			horizon: '1y',
			monthlyContribution: 500,
		});

		expect(output.modelVersion).toBe('future_simulator_v1');
		expect(output.scenarios.base.projectedValue).toBe(17100);
		expect(mockFutureSimulatorService.simulate).toHaveBeenCalledWith({
			positions: [],
			horizon: '1y',
			monthlyContribution: 500,
		});
	});

	it('delegates premium/global insight generation', async () => {
		(mockPremiumInsightsService.generate as jest.Mock).mockResolvedValue({
			modelVersion: 'premium_insights_v1',
			plan: 'premium',
			insights: [],
			signals: {
				risk: 0,
				opportunity: 0,
				fiscal: 0,
				future: 0,
				rebalance: 0,
			},
			warnings: [],
		});

		const facade = makeFacade();
		const output = await facade.getPremiumInsights({
			plan: 'premium',
			positions: [],
		});

		expect(output.modelVersion).toBe('premium_insights_v1');
		expect(mockPremiumInsightsService.generate).toHaveBeenCalledWith({
			plan: 'premium',
			positions: [],
		});
	});
});
