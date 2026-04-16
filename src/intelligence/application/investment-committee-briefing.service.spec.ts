import { InvestmentCommitteeBriefingService } from 'src/intelligence/application/investment-committee-briefing.service';

describe('InvestmentCommitteeBriefingService', () => {
	it('builds weekly briefing with risks, recommend and avoid lists', async () => {
		const facadeMock = {
			getPortfolioRiskAnalysis: jest.fn().mockReturnValue({
				risk: { score: 72, level: 'high', flags: [{ severity: 'high', message: 'Concentração elevada em setor financeiro.' }] },
				concentrationByAsset: [
					{ key: 'ITUB4', severity: 'high' },
					{ key: 'BBDC4', severity: 'medium' },
					{ key: 'PETR4', severity: 'medium' },
				],
			}),
			detectOpportunities: jest.fn().mockResolvedValue({
				opportunities: [{ symbol: 'WEGE3' }, { symbol: 'TAEE11' }, { symbol: 'EGIE3' }],
				warnings: [],
			}),
		} as any;
		const service = new InvestmentCommitteeBriefingService(facadeMock);
		const result = await service.generate({
			plan: 'global_investor',
			positions: [],
			watchlistSymbols: ['WEGE3'],
		});

		expect(result.recommendedAssets).toHaveLength(3);
		expect(result.avoidAssets).toHaveLength(3);
		expect(result.weeklyObjectivePlan).toHaveLength(3);
	});
});
