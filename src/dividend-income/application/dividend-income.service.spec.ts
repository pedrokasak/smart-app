import type { FinancialPlanService } from 'src/financial-plan/financial-plan.service';
import type { PortfolioService } from 'src/portfolio/portfolio.service';
import { DividendIncomeService } from './dividend-income.service';

const recent = new Date(Date.now() - 30 * 86_400_000);

const portfolios = [
	{
		_id: 'p1',
		assets: [
			{
				symbol: 'MXRF11',
				quantity: 1000,
				price: 10,
				currentPrice: 10,
				dividendHistory: [{ date: recent, value: 0.1 }],
			},
		],
	},
	{
		_id: 'p2',
		assets: [
			{
				symbol: 'TAEE11',
				quantity: 100,
				price: 30,
				currentPrice: 30,
				dividendHistory: [{ date: recent, value: 2 }],
			},
		],
	},
];

const build = (plan: () => Promise<any>) => {
	const portfolioService = {
		getUserPortfolios: jest.fn(async () => portfolios),
	};
	const financialPlanService = { get: jest.fn(plan) };
	return {
		portfolioService,
		service: new DividendIncomeService(
			portfolioService as unknown as PortfolioService,
			financialPlanService as unknown as FinancialPlanService
		),
	};
};

describe('DividendIncomeService', () => {
	const plan = async () => ({
		monthlyContribution: 500,
		expectedRealReturnPct: 6,
		horizonYears: 20,
		goals: [
			{
				id: 'g1',
				title: 'Independência',
				kind: 'independence',
				targetAmount: 500_000,
				currentAmount: 0,
				monthlyContribution: 0,
			},
		],
	});

	it('reads only the caller portfolios and uses the independence goal', async () => {
		const { service, portfolioService } = build(plan);

		const result = await service.insight('user-1', { level: 'iniciante' });

		expect(portfolioService.getUserPortfolios).toHaveBeenCalledWith('user-1');
		expect(result.facts.total12m).toBe(300);
		expect(result.facts.goal?.title).toBe('Independência');
		expect(result.didactic?.level).toBe('iniciante');
	});

	it('portfolioId filters among the caller portfolios only', async () => {
		const { service } = build(plan);

		const one = await service.insight('user-1', { portfolioId: 'p2' });
		const foreign = await service.insight('user-1', {
			portfolioId: 'someone-else',
		});

		expect(one.facts.payers.map((payer) => payer.symbol)).toEqual(['TAEE11']);
		expect(foreign.facts.total12m).toBe(0);
		expect(foreign.didactic).toBeNull();
	});

	it('a broken plan read drops the goal, not the block', async () => {
		const { service } = build(async () => {
			throw new Error('mongo down');
		});

		const result = await service.insight('user-1');

		expect(result.facts.goal).toBeNull();
		expect(result.didactic?.level).toBe('intermediario');
	});
});
