import { RagFactBuilderService } from 'src/ai/rag-ingestion/application/rag-fact-builder.service';
import { UnifiedIntelligenceFacade } from 'src/intelligence/application/unified-intelligence.facade';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';

describe('RagFactBuilderService (TRA-84)', () => {
	let facade: {
		getPortfolioSummary: jest.Mock;
		getPortfolioRiskAnalysis: jest.Mock;
	};
	let builder: RagFactBuilderService;

	const positions = [
		{ symbol: 'PETR4', assetType: 'stock', quantity: 100, sector: 'Energia' },
	] as unknown as PortfolioIntelligencePosition[];

	beforeEach(() => {
		facade = {
			getPortfolioSummary: jest.fn().mockReturnValue({
				totalValue: 150000.37,
				positionsCount: 3,
				allocationByAsset: [{ key: 'PETR4', value: 33000, percentage: 22.03 }],
				diversification: { score: 7.2, maxScore: 10, status: 'good' },
				dividendProjection: {
					projectedAnnualIncome: 12000.55,
					projectedMonthlyIncome: 1000.04,
					projectedYieldOnPortfolioPct: 8.01,
				},
			}),
			getPortfolioRiskAnalysis: jest.fn().mockReturnValue({
				risk: {
					level: 'medium',
					score: 42.4,
					flags: [
						{ code: 'x', severity: 'high', message: 'concentração alta' },
						{ code: 'y', severity: 'low', message: 'ignorar este' },
					],
				},
				concentrationByAsset: [
					{ key: 'PETR4', percentage: 40.2, severity: 'high' },
				],
			}),
		};
		builder = new RagFactBuilderService(
			facade as unknown as UnifiedIntelligenceFacade
		);
	});

	it('produces the four source types with real producers', () => {
		const items = builder.build(positions, '2026-08-21');
		const types = items.map((i) => i.sourceType).sort();
		expect(types).toEqual([
			'portfolio_dividend',
			'portfolio_performance',
			'portfolio_position',
			'portfolio_risk',
		]);
	});

	it('ROUNDS every number to avoid hash churn (TRA-74)', () => {
		// O ponto: 22.03% vira "22%", nunca "22,03%". Centavo oscilando entre
		// ciclos nao pode mudar o texto, senao re-embeda tudo todo dia.
		const items = builder.build(positions, '2026-08-21');
		const position = items.find((i) => i.sourceType === 'portfolio_position');
		expect(position?.content).toContain('22%');
		expect(position?.content).not.toContain('22,03');
		expect(position?.content).not.toContain('22.03');

		const dividend = items.find((i) => i.sourceType === 'portfolio_dividend');
		expect(dividend?.content).toContain('8%');
		expect(dividend?.content).not.toMatch(/8[.,]01/);
	});

	it('uses stable source_ids so the hash diff can match across cycles', () => {
		const items = builder.build(positions, '2026-08-21');
		expect(
			items.find((i) => i.sourceType === 'portfolio_position')?.sourceId
		).toBe('position:PETR4');
		expect(items.find((i) => i.sourceType === 'portfolio_risk')?.sourceId).toBe(
			'risk:summary'
		);
	});

	it('drops low-severity risk flags and keeps high-severity ones', () => {
		const risk = builder
			.build(positions, '2026-08-21')
			.find((i) => i.sourceType === 'portfolio_risk');
		expect(risk?.content).toContain('concentração alta');
		expect(risk?.content).not.toContain('ignorar este');
	});

	it('returns nothing for an empty portfolio', () => {
		expect(builder.build([], '2026-08-21')).toEqual([]);
	});

	it('stamps as_of on every item', () => {
		const items = builder.build(positions, '2026-08-21');
		expect(items.every((i) => i.asOf === '2026-08-21')).toBe(true);
	});
});
