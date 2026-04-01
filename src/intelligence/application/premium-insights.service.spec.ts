import { TaxEngineService } from 'src/fiscal/tax-engine/application/tax-engine.service';
import { FutureSimulatorService } from 'src/intelligence/application/future-simulator.service';
import { OpportunityRadarService } from 'src/intelligence/application/opportunity-radar.service';
import { PremiumInsightsService } from 'src/intelligence/application/premium-insights.service';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';

describe('PremiumInsightsService', () => {
	const positions: PortfolioIntelligencePosition[] = [
		{
			symbol: 'ITUB4',
			assetType: 'stock',
			quantity: 10,
			totalValue: 1000,
			sector: 'FINANCIAL',
		},
		{
			symbol: 'XPLG11',
			assetType: 'fii',
			quantity: 10,
			totalValue: 1000,
			sector: 'REAL_ESTATE',
		},
	];

	const makeService = (mocks?: {
		portfolioAnalysis?: any;
		opportunityOutput?: any;
		fiscalOutput?: any;
		futureOutput?: any;
	}) => {
		const portfolioIntelligenceService = {
			analyzePositions: jest.fn().mockReturnValue(
				mocks?.portfolioAnalysis || {
					facts: {
						concentrationByAsset: [
							{ key: 'ITUB4', percentage: 55, severity: 'high' },
						],
						concentrationBySector: [
							{ key: 'FINANCIAL', percentage: 55, severity: 'high' },
						],
					},
					estimates: {
						risk: { level: 'high', score: 82 },
					},
				}
			),
		} as unknown as PortfolioIntelligenceService;

		const opportunityRadarService = {
			detect: jest.fn().mockResolvedValue(
				mocks?.opportunityOutput || {
					modelVersion: 'opportunity_radar_v1',
					opportunities: [],
					underallocatedSectors: [],
					signals: [],
					unavailableSymbols: [],
					warnings: [],
				}
			),
		} as unknown as OpportunityRadarService;

		const taxEngineService = {
			simulateSaleImpact: jest.fn().mockReturnValue(
				mocks?.fiscalOutput || {
					symbol: 'ITUB4',
					estimatedTax: 0,
					compensationUsed: 0,
					classification: 'isento',
				}
			),
		} as unknown as TaxEngineService;

		const futureSimulatorService = {
			simulate: jest.fn().mockReturnValue(
				mocks?.futureOutput || {
					horizon: '5y',
					currentPortfolioValue: 2000,
					scenarios: {
						base: { projectedValue: 3000 },
					},
					dividendProjection: {
						scenarios: {
							base: { annual: 240 },
						},
					},
				}
			),
		} as unknown as FutureSimulatorService;

		return new PremiumInsightsService(
			portfolioIntelligenceService,
			taxEngineService,
			opportunityRadarService,
			futureSimulatorService
		);
	};

	it('prioritizes risk insight when concentration is high', async () => {
		const service = makeService();

		const output = await service.generate({
			plan: 'premium',
			positions,
		});

		expect(output.insights[0].category).toBe('risk');
		expect(output.insights[0].priority).toBe('critical');
	});

	it('prioritizes opportunity insight when strong opportunity signal exists', async () => {
		const service = makeService({
			portfolioAnalysis: {
				facts: {
					concentrationByAsset: [
						{ key: 'ITUB4', percentage: 20, severity: 'medium' },
					],
					concentrationBySector: [
						{ key: 'FINANCIAL', percentage: 20, severity: 'medium' },
					],
				},
				estimates: {
					risk: { level: 'medium', score: 44 },
				},
			},
			opportunityOutput: {
				modelVersion: 'opportunity_radar_v1',
				opportunities: [],
				underallocatedSectors: [],
				signals: [
					{
						id: 'opportunity:BBAS3',
						symbol: 'BBAS3',
						kind: 'opportunity',
						priority: 'high',
						score: 90,
						title: 'BBAS3 em faixa atrativa',
						details: ['valuation_price_to_earnings_attractive'],
					},
				],
				unavailableSymbols: [],
				warnings: [],
			},
		});

		const output = await service.generate({
			plan: 'premium',
			positions,
		});

		expect(output.insights[0].category).toBe('opportunity');
		expect(output.insights[0].relatedSymbols).toEqual(['BBAS3']);
	});

	it('includes fiscal insight when sell simulation has relevant tax impact', async () => {
		const service = makeService({
			fiscalOutput: {
				symbol: 'ITUB4',
				estimatedTax: 120,
				compensationUsed: 50,
				classification: 'tributavel_com_compensacao',
			},
		});

		const output = await service.generate({
			plan: 'premium',
			positions,
			fiscalInput: {
				sellSimulation: {
					symbol: 'ITUB4',
					assetType: 'stock',
					quantityToSell: 5,
					sellPrice: 130,
					simulatedSellDate: '2026-03-25',
					currentPosition: {
						quantity: 10,
						totalCost: 1000,
					},
				},
			},
		});

		expect(output.insights.some((item) => item.category === 'fiscal')).toBe(
			true
		);
		expect(
			output.insights.find((item) => item.category === 'fiscal')?.priority
		).toBe('high');
	});

	it('handles conflict between risk and opportunity signals by lowering opportunity score', async () => {
		const service = makeService({
			opportunityOutput: {
				modelVersion: 'opportunity_radar_v1',
				opportunities: [],
				underallocatedSectors: [],
				signals: [
					{
						id: 'opportunity:ITUB4',
						symbol: 'ITUB4',
						kind: 'opportunity',
						priority: 'high',
						score: 88,
						title: 'ITUB4 em faixa atrativa',
						details: ['valuation signal'],
					},
				],
				unavailableSymbols: [],
				warnings: [],
			},
		});

		const output = await service.generate({
			plan: 'global_investor',
			positions,
		});
		const riskInsight = output.insights.find(
			(item) => item.category === 'risk'
		);
		const opportunityInsight = output.insights.find(
			(item) => item.category === 'opportunity'
		);

		expect(riskInsight).toBeDefined();
		expect(opportunityInsight).toBeDefined();
		expect(opportunityInsight!.score).toBeLessThan(88);
		expect(opportunityInsight!.justification).toEqual(
			expect.arrayContaining([
				'Conflito com sinal de risco para o mesmo ativo.',
			])
		);
	});
});
