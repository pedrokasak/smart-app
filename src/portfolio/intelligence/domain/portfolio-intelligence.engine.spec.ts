import { PortfolioIntelligenceEngine } from 'src/portfolio/intelligence/domain/portfolio-intelligence.engine';

describe('PortfolioIntelligenceEngine rebalance inputs', () => {
	it('detects asset concentration above configured limit', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyze(
			[
				{
					symbol: 'PETR4',
					assetType: 'stock',
					quantity: 100,
					totalValue: 8000,
					sector: 'Energy',
				},
				{
					symbol: 'VALE3',
					assetType: 'stock',
					quantity: 10,
					totalValue: 2000,
					sector: 'Materials',
				},
			],
			{ assetMaxConcentrationPct: 35 }
		);

		expect(
			result.estimates.rebalanceSuggestionInputs.assetConcentrationSignals
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'asset',
					key: 'PETR4',
					status: 'above_limit',
				}),
			])
		);
	});

	it('detects sector above limit and below recommended minimum', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyze(
			[
				{
					symbol: 'PETR4',
					assetType: 'stock',
					quantity: 10,
					totalValue: 7000,
					sector: 'Energy',
				},
				{
					symbol: 'WEGE3',
					assetType: 'stock',
					quantity: 5,
					totalValue: 2000,
					sector: 'Industrial',
				},
				{
					symbol: 'BBAS3',
					assetType: 'stock',
					quantity: 5,
					totalValue: 1000,
					sector: 'Financial',
				},
			],
			{
				sectorLimitsByKey: {
					ENERGY: { maxPct: 50 },
					FINANCIAL: { minPct: 20, maxPct: 50 },
				},
			}
		);

		expect(
			result.estimates.rebalanceSuggestionInputs.sectorLimitSignals
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'sector',
					key: 'ENERGY',
					status: 'above_limit',
				}),
				expect.objectContaining({
					type: 'sector',
					key: 'FINANCIAL',
					status: 'below_limit',
				}),
			])
		);
	});

	it('detects class drift when target allocation is configured', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyze(
			[
				{
					symbol: 'PETR4',
					assetType: 'stock',
					quantity: 1,
					totalValue: 7000,
					sector: 'Energy',
				},
				{
					symbol: 'XPLG11',
					assetType: 'fii',
					quantity: 1,
					totalValue: 2000,
					sector: 'Logistics',
				},
				{
					symbol: 'BTC',
					assetType: 'crypto',
					quantity: 1,
					totalValue: 1000,
					sector: null,
				},
			],
			{
				targetAllocationByClass: {
					equities: 40,
					real_estate: 40,
					crypto: 20,
				},
			}
		);

		expect(result.estimates.rebalanceSuggestionInputs.hasTargetAllocation).toBe(
			true
		);
		expect(
			result.estimates.rebalanceSuggestionInputs.classAllocationSignals
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					assetClass: 'equities',
					status: 'above_target',
				}),
				expect.objectContaining({
					assetClass: 'real_estate',
					status: 'below_target',
				}),
			])
		);
	});

	it('degrades safely when no target allocation is configured', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyze([
			{
				symbol: 'PETR4',
				assetType: 'stock',
				quantity: 1,
				totalValue: 5000,
				sector: 'Energy',
			},
		]);

		expect(result.estimates.rebalanceSuggestionInputs.hasTargetAllocation).toBe(
			false
		);
		expect(
			result.estimates.rebalanceSuggestionInputs.classAllocationSignals
		).toEqual([]);
		expect(
			result.estimates.rebalanceSuggestionInputs.assetConcentrationSignals
				.length
		).toBeGreaterThan(0);
	});

	it('returns no relevant rebalance signals for balanced portfolio', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyze(
			[
				{
					symbol: 'WEGE3',
					assetType: 'stock',
					quantity: 1,
					totalValue: 3400,
					sector: 'Industrial',
				},
				{
					symbol: 'HGLG11',
					assetType: 'fii',
					quantity: 1,
					totalValue: 3300,
					sector: 'Logistics',
				},
				{
					symbol: 'BTC',
					assetType: 'crypto',
					quantity: 1,
					totalValue: 3300,
					sector: 'Digital Assets',
				},
			],
			{
				targetAllocationByClass: {
					equities: 34,
					real_estate: 33,
					crypto: 33,
				},
				assetMaxConcentrationPct: 40,
				sectorMaxConcentrationPct: 45,
			}
		);

		expect(result.estimates.rebalanceSuggestionInputs.hasRelevantSignals).toBe(
			false
		);
		expect(
			result.estimates.rebalanceSuggestionInputs.exposureImbalances
		).toEqual([]);
	});

	it('projects dividend flow using deterministic sources', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyze([
			{
				symbol: 'TAEE11',
				assetType: 'stock',
				quantity: 100,
				totalValue: 3000,
				sector: 'Utilities',
				annualDividendPerUnit: 1.2,
			},
			{
				symbol: 'HGLG11',
				assetType: 'fii',
				quantity: 50,
				totalValue: 5000,
				sector: 'Logistics',
				dividendYield: 10,
			},
			{
				symbol: 'BBAS3',
				assetType: 'stock',
				quantity: 10,
				totalValue: 2000,
				sector: 'Financial',
				dividendHistory: [
					{
						date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
						value: 0.7,
					},
					{
						date: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
						value: 0.5,
					},
				],
			},
		]);

		expect(result.estimates.dividendProjection.projectedAnnualIncome).toBeCloseTo(
			632,
			0
		);
		expect(
			result.estimates.dividendProjection.projectedMonthlyIncome
		).toBeGreaterThan(50);
		expect(
			result.estimates.dividendProjection.coverage.positionsWithData
		).toBe(3);
		expect(result.estimates.dividendProjection.byAssetClass.length).toBeGreaterThan(
			0
		);
	});

	it('degrades dividend projection safely with missing metadata', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyze([
			{
				symbol: 'BTC',
				assetType: 'crypto',
				quantity: 1,
				totalValue: 10000,
				sector: null,
			},
			{
				symbol: 'WEGE3',
				assetType: 'stock',
				quantity: 10,
				totalValue: 3000,
				sector: 'Industrial',
				dividendYield: 0.02,
			},
		]);

		expect(result.estimates.dividendProjection.projectedAnnualIncome).toBe(60);
		expect(
			result.estimates.dividendProjection.coverage.positionsWithData
		).toBe(1);
		expect(
			result.estimates.dividendProjection.coverage.positionsWithoutData
		).toBe(1);
	});

	it('computes allocation by geography with known regions', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyze([
			{
				symbol: 'AAPL',
				assetType: 'stock',
				quantity: 1,
				totalValue: 6000,
				sector: 'Technology',
				geography: 'US',
			},
			{
				symbol: 'VALE3',
				assetType: 'stock',
				quantity: 1,
				totalValue: 3000,
				sector: 'Materials',
				geography: 'BR',
			},
			{
				symbol: 'EWZ',
				assetType: 'etf',
				quantity: 1,
				totalValue: 1000,
				sector: 'ETF',
				geography: 'BR',
			},
		]);

		expect(result.facts.allocationByGeography).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: 'US', percentage: 60 }),
				expect.objectContaining({ key: 'BR', percentage: 40 }),
			])
		);
		expect(result.facts.geographiesCount).toBe(2);
		expect(result.facts.unknownGeographyExposurePct).toBe(0);
	});

	it('handles missing geography metadata safely', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyze([
			{
				symbol: 'PETR4',
				assetType: 'stock',
				quantity: 1,
				totalValue: 7000,
				sector: 'Energy',
			},
			{
				symbol: 'AAPL',
				assetType: 'stock',
				quantity: 1,
				totalValue: 3000,
				sector: 'Technology',
				geography: 'US',
			},
		]);

		expect(result.facts.allocationByGeography).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: 'UNKNOWN', percentage: 70 }),
				expect.objectContaining({ key: 'US', percentage: 30 }),
			])
		);
		expect(result.facts.unknownGeographyExposurePct).toBe(70);
	});

	it('identifies high concentration in a single asset', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyze([
			{
				symbol: 'PETR4',
				assetType: 'stock',
				quantity: 1,
				totalValue: 9000,
				sector: 'Energy',
			},
			{
				symbol: 'ITUB4',
				assetType: 'stock',
				quantity: 1,
				totalValue: 1000,
				sector: 'Financial',
			},
		]);

		expect(result.facts.allocationByAsset[0]).toMatchObject({
			key: 'PETR4',
			percentage: 90,
		});
		expect(result.facts.concentrationByAsset[0].severity).toBe('high');
	});

	it('returns strong diversification metrics for a well-diversified portfolio', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyze([
			{
				symbol: 'WEGE3',
				assetType: 'stock',
				quantity: 1,
				totalValue: 2500,
				sector: 'Industrial',
			},
			{
				symbol: 'XPLG11',
				assetType: 'fii',
				quantity: 1,
				totalValue: 2500,
				sector: 'Logistics',
			},
			{
				symbol: 'BTC',
				assetType: 'crypto',
				quantity: 1,
				totalValue: 2500,
				sector: 'Digital Assets',
			},
			{
				symbol: 'BOVA11',
				assetType: 'etf',
				quantity: 1,
				totalValue: 2500,
				sector: 'ETF',
			},
		]);

		expect(result.estimates.diversification.score).toBeGreaterThanOrEqual(70);
		expect(result.facts.concentrationByAsset[0].severity).toBe('medium');
	});

	it('calculates class and sector allocations correctly with multiple sectors', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyze([
			{
				symbol: 'VALE3',
				assetType: 'stock',
				quantity: 1,
				totalValue: 5000,
				sector: 'Materials',
			},
			{
				symbol: 'BBAS3',
				assetType: 'stock',
				quantity: 1,
				totalValue: 2000,
				sector: 'Financial',
			},
			{
				symbol: 'HGLG11',
				assetType: 'fii',
				quantity: 1,
				totalValue: 3000,
				sector: 'Logistics',
			},
		]);

		expect(result.facts.allocationByClass).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: 'equities', percentage: 70 }),
				expect.objectContaining({ key: 'real_estate', percentage: 30 }),
			])
		);
		expect(result.facts.concentrationBySector).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: 'MATERIALS', percentage: 50 }),
				expect.objectContaining({ key: 'FINANCIAL', percentage: 20 }),
				expect.objectContaining({ key: 'LOGISTICS', percentage: 30 }),
			])
		);
	});

	it('handles partial metadata safely by routing to UNKNOWN buckets', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyze([
			{
				symbol: 'AAPL',
				assetType: 'stock',
				quantity: 1,
				totalValue: 6000,
				geography: 'US',
			},
			{
				symbol: 'ETH',
				assetType: 'crypto',
				quantity: 1,
				totalValue: 4000,
			},
		]);

		expect(result.facts.concentrationBySector).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: 'UNKNOWN', percentage: 100 }),
			])
		);
		expect(result.facts.allocationByGeography).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: 'US', percentage: 60 }),
				expect.objectContaining({ key: 'UNKNOWN', percentage: 40 }),
			])
		);
	});
});

describe('PortfolioIntelligenceEngine portfolio fit', () => {
	it('classifies as bom when candidate improves diversification', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyzePortfolioFit(
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
				totalValue: 5000,
				sector: 'Digital Assets',
			}
		);

		expect(result.classification).toBe('bom');
		expect(result.impact.diversification.deltaScore).toBeGreaterThan(0);
		expect(result.signals).toContain('diversification_improved');
	});

	it('classifies as ruim when candidate worsens sector concentration', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyzePortfolioFit(
			[
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
			{
				symbol: 'PRIO3',
				assetType: 'stock',
				quantity: 1,
				totalValue: 5000,
				sector: 'Energy',
			}
		);

		expect(result.classification).toBe('ruim');
		expect(result.impact.sectorConcentration.deltaPercentage).toBeGreaterThan(0);
		expect(result.signals).toEqual(
			expect.arrayContaining([
				'sector_concentration_increased',
				'candidate_sector_highly_concentrated',
			])
		);
	});

	it('degrades safely when candidate metadata is incomplete', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyzePortfolioFit(
			[
				{
					symbol: 'WEGE3',
					assetType: 'stock',
					quantity: 1,
					totalValue: 10000,
					sector: 'Industrial',
				},
			],
			{
				symbol: 'AAPL',
				assetType: 'stock',
				quantity: 1,
				totalValue: 2000,
				sector: null,
			}
		);

		expect(result.classification).toBe('neutro');
		expect(result.confidence).toBe('low');
		expect(result.candidate.hasCompleteMetadata).toBe(false);
		expect(result.signals).toContain('candidate_metadata_incomplete');
	});

	it('identifies when candidate asset already exists in portfolio', () => {
		const engine = new PortfolioIntelligenceEngine();
		const result = engine.analyzePortfolioFit(
			[
				{
					symbol: 'ITUB4',
					assetType: 'stock',
					quantity: 10,
					totalValue: 5000,
					sector: 'Financial',
				},
				{
					symbol: 'XPLG11',
					assetType: 'fii',
					quantity: 5,
					totalValue: 5000,
					sector: 'Logistics',
				},
			],
			{
				symbol: 'ITUB4',
				assetType: 'stock',
				quantity: 5,
				totalValue: 2500,
				sector: 'Financial',
			}
		);

		const equitiesImpact = result.impact.allocationByClass.find(
			(entry) => entry.assetClass === 'equities'
		);
		expect(result.candidate.alreadyInPortfolio).toBe(true);
		expect(equitiesImpact?.deltaPercentage).toBeGreaterThan(0);
	});
});
