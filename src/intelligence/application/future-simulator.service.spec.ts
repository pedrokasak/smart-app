import { FutureSimulatorService } from 'src/intelligence/application/future-simulator.service';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';

describe('FutureSimulatorService', () => {
	const service = new FutureSimulatorService();

	it('projects scenarios without monthly contribution', () => {
		const positions: PortfolioIntelligencePosition[] = [
			{
				symbol: 'ITUB4',
				assetType: 'stock',
				quantity: 10,
				totalValue: 10000,
				annualDividendPerUnit: 1.2,
			},
		];

		const output = service.simulate({
			positions,
			horizon: '1y',
		});

		expect(output.currentPortfolioValue).toBe(10000);
		expect(output.monthlyContribution).toBe(0);
		expect(output.scenarios.pessimistic.projectedValue).toBeLessThan(
			output.scenarios.base.projectedValue
		);
		expect(output.scenarios.base.projectedValue).toBeLessThan(
			output.scenarios.optimistic.projectedValue
		);
		expect(output.confidence).toBe('high');
		expect(output.limitations).toEqual([]);
		expect(output.dividendProjection.current.annual).toBe(12);
		expect(output.dividendProjection.scenarios.base.annual).toBeGreaterThanOrEqual(12);
	});

	it('projects higher future value with recurring monthly contribution', () => {
		const positions: PortfolioIntelligencePosition[] = [
			{
				symbol: 'BBAS3',
				assetType: 'stock',
				quantity: 10,
				totalValue: 10000,
				annualDividendPerUnit: 1,
			},
		];

		const withoutContribution = service.simulate({
			positions,
			horizon: '5y',
		});
		const withContribution = service.simulate({
			positions,
			horizon: '5y',
			monthlyContribution: 500,
		});

		expect(withContribution.scenarios.base.projectedValue).toBeGreaterThan(
			withoutContribution.scenarios.base.projectedValue
		);
		expect(withContribution.monthlyContribution).toBe(500);
	});

	it('supports all configured horizons with correct month mapping', () => {
		const positions: PortfolioIntelligencePosition[] = [
			{
				symbol: 'WEGE3',
				assetType: 'stock',
				quantity: 10,
				totalValue: 10000,
				annualDividendPerUnit: 0.8,
			},
		];

		const output6m = service.simulate({ positions, horizon: '6m' });
		const output1y = service.simulate({ positions, horizon: '1y' });
		const output5y = service.simulate({ positions, horizon: '5y' });
		const output10y = service.simulate({ positions, horizon: '10y' });

		expect(output6m.months).toBe(6);
		expect(output1y.months).toBe(12);
		expect(output5y.months).toBe(60);
		expect(output10y.months).toBe(120);
		expect(output10y.scenarios.base.projectedValue).toBeGreaterThan(
			output5y.scenarios.base.projectedValue
		);
	});

	it('degrades safely when portfolio data is limited', () => {
		const positions: PortfolioIntelligencePosition[] = [
			{
				symbol: 'INVALID1',
				assetType: 'stock',
				quantity: 0,
			},
			{
				symbol: 'VALID1',
				assetType: 'stock',
				quantity: 10,
				currentPrice: 20,
			},
		];

		const output = service.simulate({
			positions,
			horizon: '1y',
		});

		expect(output.currentPortfolioValue).toBe(200);
		expect(output.confidence).toBe('low');
		expect(output.limitations).toEqual(
			expect.arrayContaining(['future_simulator_partial_portfolio_data'])
		);
	});

	it('uses dividend history when annual dividend metadata is unavailable', () => {
		const now = Date.now();
		const positions: PortfolioIntelligencePosition[] = [
			{
				symbol: 'BBDC4',
				assetType: 'stock',
				quantity: 10,
				totalValue: 1000,
				dividendHistory: [
					{ date: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(), value: 0.4 },
					{ date: new Date(now - 160 * 24 * 60 * 60 * 1000).toISOString(), value: 0.4 },
					{ date: new Date(now - 260 * 24 * 60 * 60 * 1000).toISOString(), value: 0.4 },
				],
			},
		];

		const output = service.simulate({
			positions,
			horizon: '1y',
		});

		expect(output.dividendProjection.current.annual).toBe(12);
		expect(output.dividendProjection.coverage.positionsWithData).toBe(1);
	});

	it('keeps safe degradation when no position has sufficient dividend data', () => {
		const positions: PortfolioIntelligencePosition[] = [
			{
				symbol: 'ABCD3',
				assetType: 'stock',
				quantity: 10,
				totalValue: 1000,
			},
		];

		const output = service.simulate({
			positions,
			horizon: '1y',
		});

		expect(output.dividendProjection.current.annual).toBe(0);
		expect(output.limitations).toEqual(
			expect.arrayContaining(['future_simulator_dividend_data_insufficient'])
		);
	});
});
