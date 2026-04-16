import { InvestorProfileInsightsService } from 'src/intelligence/application/investor-profile-insights.service';

describe('InvestorProfileInsightsService', () => {
	it('returns profile-specific narrative for renda', () => {
		const service = new InvestorProfileInsightsService();
		const result = service.generate({
			profile: 'renda',
			portfolioSummary: {
				totalValue: 100000,
				positionsCount: 3,
				allocationByClass: [],
				allocationByAsset: [],
				allocationByGeography: [],
				diversification: { score: 60, maxScore: 100, status: 'moderate', components: { assetSpread: 1, classSpread: 1, sectorSpread: 1 } },
				dividendProjection: {
					modelVersion: 'deterministic_v1',
					projectedAnnualIncome: 12000,
					projectedMonthlyIncome: 1000,
					projectedYieldOnPortfolioPct: 12,
					coverage: { positionsWithData: 3, positionsWithoutData: 0, dataCoveragePct: 100 },
					byAssetClass: [],
				},
			},
			portfolioRisk: {
				risk: { score: 45, level: 'low', flags: [] },
				concentrationByAsset: [],
				concentrationBySector: [],
				rebalanceSuggestionInputs: {
					modelVersion: 'rebalance_inputs_v1',
					hasTargetAllocation: false,
					classAllocationSignals: [],
					assetConcentrationSignals: [],
					sectorLimitSignals: [],
					exposureImbalances: [],
					hasRelevantSignals: false,
				},
			},
		});
		expect(result.profile).toBe('renda');
		expect(result.narrative).toContain('Renda anual estimada');
		expect(result.status).toBe('degraded');
	});
});
