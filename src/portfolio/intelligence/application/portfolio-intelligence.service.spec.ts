import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';

describe('PortfolioIntelligenceService', () => {
	it('maps assets to positions and runs analysis', () => {
		const service = new PortfolioIntelligenceService();
		const result = service.analyzeAssets([
			{
				symbol: 'BBAS3',
				type: 'stock',
				quantity: 10,
				total: 1000,
				sector: 'Finance',
				geography: 'BR',
				dividendYield: 0.08,
			},
			{
				symbol: 'MXRF11',
				type: 'fii',
				quantity: 20,
				price: 10,
				sector: null,
				geography: null,
			},
		]);

		expect(result.facts.positionsCount).toBe(2);
		expect(result.facts.allocationByClass.map((item) => item.key)).toEqual(
			expect.arrayContaining(['equities', 'real_estate'])
		);
		expect(result.rules.thresholds.highAssetConcentrationPct).toBe(35);
		expect(result.estimates.dividendProjection.projectedAnnualIncome).toBe(80);
		expect(result.facts.allocationByGeography.length).toBe(2);
	});

	it('accepts custom thresholds', () => {
		const service = new PortfolioIntelligenceService();
		const result = service.analyzePositions(
			[
				{
					symbol: 'WEGE3',
					assetType: 'stock',
					quantity: 10,
					totalValue: 900,
					sector: 'Industrial',
				},
				{
					symbol: 'TAEE11',
					assetType: 'stock',
					quantity: 10,
					totalValue: 100,
					sector: 'Utilities',
				},
			],
			{
				highAssetConcentrationPct: 95,
			}
		);

		expect(result.facts.concentrationByAsset[0].severity).toBe('medium');
		expect(result.rules.thresholds.highAssetConcentrationPct).toBe(95);
	});

	it('passes rebalance config to engine analysis', () => {
		const service = new PortfolioIntelligenceService();
		const result = service.analyzePositions(
			[
				{
					symbol: 'PETR4',
					assetType: 'stock',
					quantity: 1,
					totalValue: 700,
					sector: 'Energy',
				},
				{
					symbol: 'XPLG11',
					assetType: 'fii',
					quantity: 1,
					totalValue: 300,
					sector: 'Logistics',
				},
			],
			undefined,
			{
				targetAllocationByClass: {
					equities: 50,
					real_estate: 50,
				},
			}
		);

		expect(result.estimates.rebalanceSuggestionInputs.hasTargetAllocation).toBe(
			true
		);
		expect(
			result.estimates.rebalanceSuggestionInputs.classAllocationSignals.length
		).toBeGreaterThan(0);
	});

	it('runs portfolio fit analysis with candidate outside portfolio', () => {
		const service = new PortfolioIntelligenceService();
		const result = service.analyzePortfolioFit(
			[
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
			{
				symbol: 'BTC',
				assetType: 'crypto',
				quantity: 1,
				totalValue: 4000,
				sector: 'Digital Assets',
			}
		);

		expect(result.candidate.alreadyInPortfolio).toBe(false);
		expect(result.impact.diversification.deltaScore).toBeGreaterThan(0);
	});

	it('maps asset inputs and executes portfolio fit analysis', () => {
		const service = new PortfolioIntelligenceService();
		const result = service.analyzeAssetPortfolioFit(
			[
				{
					symbol: 'ITUB4',
					type: 'stock',
					quantity: 10,
					total: 5000,
					sector: 'Financial',
				},
			],
			{
				symbol: 'ITUB4',
				type: 'stock',
				quantity: 5,
				total: 2500,
				sector: 'Financial',
			}
		);

		expect(result.candidate.alreadyInPortfolio).toBe(true);
		expect(result.candidate.symbol).toBe('ITUB4');
	});
});
