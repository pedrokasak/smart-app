import { TrackerrScoreService } from 'src/intelligence/application/trackerr-score.service';

describe('TrackerrScoreService', () => {
	const service = new TrackerrScoreService(
		{} as any,
		{} as any,
		{} as any,
		{} as any
	);

	it('calculates explainable score with visible weights and reason codes', () => {
		const output = service.computeScore({
			symbol: 'ITUB4',
			assetType: 'stock',
			qualityMetrics: {
				roe: 20,
				netMargin: 0.2,
				dividendYield: 0.07,
			},
			riskMetrics: {
				changePercent24h: 1.2,
				concentrationPct: 7,
			},
			valuationMetrics: {
				priceToEarnings: 10,
				priceToBook: 1.2,
			},
			fiscalMetrics: {
				estimatedTaxRateOnPnl: 0,
				estimatedTaxAbsolute: 0,
				monthlyExemptionApplied: true,
				hasOwnedPosition: true,
			},
			portfolioFitMetrics: {
				fitClassification: 'bom',
				diversificationDeltaScore: 4,
			},
		});

		expect(output.weights.qualidade).toBe(0.25);
		expect(output.weights.portfolio_fit).toBe(0.2);
		expect(output.pillars).toHaveLength(5);
		expect(output.reasonCodes.upward.length).toBeGreaterThan(0);
		expect(output.overallScore).toBeGreaterThan(0);
	});

	it('returns downward reason codes when previous pillar scores are higher', () => {
		const output = service.computeScore({
			symbol: 'ITUB4',
			assetType: 'stock',
			qualityMetrics: {
				roe: 6,
				netMargin: 0.03,
				dividendYield: 0,
			},
			riskMetrics: {
				changePercent24h: 8,
				concentrationPct: 30,
			},
			valuationMetrics: {
				priceToEarnings: 30,
				priceToBook: 4,
			},
			fiscalMetrics: {
				estimatedTaxRateOnPnl: 0.15,
				estimatedTaxAbsolute: 500,
				monthlyExemptionApplied: false,
				hasOwnedPosition: true,
			},
			portfolioFitMetrics: {
				fitClassification: 'ruim',
				diversificationDeltaScore: -4,
			},
			previousPillarScores: {
				qualidade: 80,
				risco: 70,
				valuation: 70,
				fiscal: 70,
				portfolio_fit: 70,
			},
		});

		expect(output.reasonCodes.downward).toContain('score_down_qualidade_vs_previous');
	});
});
