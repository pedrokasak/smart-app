import { DEFAULT_INVESTMENT_POLICY } from 'src/investment-policy/domain/investment-policy';
import type { InvestmentPolicyService } from 'src/investment-policy/investment-policy.service';
import { TradeModel } from 'src/fiscal/schema/trade.model';
import type { PortfolioErrorRadarService } from './portfolio-error-radar.service';
import { UserErrorRadarService } from './user-error-radar.service';

jest.mock('src/fiscal/schema/trade.model', () => ({
	TradeModel: { find: jest.fn() },
}));

function setup(trades: unknown[] = []) {
	(TradeModel.find as jest.Mock).mockReturnValue({
		select: () => ({ lean: async () => trades }),
	});
	const radar = {
		detectForUser: jest.fn(() => ({ alerts: [] })),
	} as unknown as jest.Mocked<PortfolioErrorRadarService>;
	const policy = {
		get: jest.fn(async () => ({
			policy: { ...DEFAULT_INVESTMENT_POLICY, maxAssetWeightPct: 10 },
			isDefault: false,
			savedAt: null,
		})),
	} as unknown as InvestmentPolicyService;
	return { service: new UserErrorRadarService(radar, policy), radar };
}

describe('UserErrorRadarService', () => {
	it('passes the user policy, the cost of each position and the latest quote date', async () => {
		const { service, radar } = setup([
			{
				symbol: 'VALE3',
				side: 'buy',
				quantity: 10,
				price: 60,
				fees: 0,
				date: new Date('2025-01-10'),
			},
		]);

		await service.detect(
			'user-1',
			[
				// Manual: `price` é o preço de compra.
				{
					symbol: 'petr4',
					type: 'stock',
					quantity: 100,
					price: 25,
					currentPrice: 30,
					currentPriceAt: '2026-10-07T21:00:00Z',
					source: 'manual',
				},
				// Relatório da B3 sem preço médio: custo vem das negociações.
				{
					symbol: 'VALE3',
					type: 'stock',
					quantity: 10,
					price: 70,
					source: 'b3',
					currentPriceAt: '2026-10-08T21:00:00Z',
				},
				// Sem custo conhecido.
				{
					symbol: 'BTC',
					type: 'crypto',
					quantity: 0.1,
					price: 350000,
					source: 'b3',
				},
				// Sem preço: fica de fora.
				{ symbol: 'XPTO3', type: 'stock', quantity: 5, price: 0 },
			],
			[]
		);

		const [, context] = radar.detectForUser.mock.calls[0];
		expect(context.policy.maxAssetWeightPct).toBe(10);
		expect(context.pricesAsOf).toBe('2026-10-08T21:00:00.000Z');
		expect(context.holdings).toEqual([
			{
				symbol: 'PETR4',
				assetType: 'stock',
				quantity: 100,
				price: 30,
				totalCost: 2500,
			},
			{
				symbol: 'VALE3',
				assetType: 'stock',
				quantity: 10,
				price: 70,
				totalCost: 600,
			},
			{
				symbol: 'BTC',
				assetType: 'crypto',
				quantity: 0.1,
				price: 350000,
				totalCost: null,
			},
		]);
	});

	it('reports no quote date when no position has one', async () => {
		const { service, radar } = setup();

		await service.detect(
			'user-1',
			[{ symbol: 'PETR4', type: 'stock', quantity: 1, price: 30 }],
			[]
		);

		expect(radar.detectForUser.mock.calls[0][1].pricesAsOf).toBeNull();
	});
});
