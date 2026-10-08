import { MongoPlanQuotaUsage } from './mongo-plan-quota-usage';

function fakeModel(overrides: Record<string, jest.Mock> = {}) {
	return {
		countDocuments: jest.fn().mockResolvedValue(0),
		distinct: jest.fn().mockResolvedValue([]),
		...overrides,
	};
}

describe('MongoPlanQuotaUsage (TRA-197)', () => {
	function build(models: Record<string, any>) {
		return new MongoPlanQuotaUsage({ models } as any);
	}

	it('conta carteiras e contas de corretora pelo dono', async () => {
		const portfolio = fakeModel({
			countDocuments: jest.fn().mockResolvedValue(2),
		});
		const broker = fakeModel({
			countDocuments: jest.fn().mockResolvedValue(4),
		});
		const usage = build({ Portfolio: portfolio, BrokerConnection: broker });

		expect(await usage.count('u1', 'portfolios')).toBe(2);
		expect(await usage.count('u1', 'broker_connections')).toBe(4);
		expect(portfolio.countDocuments).toHaveBeenCalledWith({ userId: 'u1' });
		expect(broker.countDocuments).toHaveBeenCalledWith({ userId: 'u1' });
	});

	it('conta ativos em todas as carteiras do usuário', async () => {
		const portfolio = fakeModel({
			distinct: jest.fn().mockResolvedValue(['p1', 'p2']),
		});
		const asset = fakeModel({ countDocuments: jest.fn().mockResolvedValue(7) });
		const usage = build({ Portfolio: portfolio, Asset: asset });

		expect(await usage.count('u1', 'assets')).toBe(7);
		expect(asset.countDocuments).toHaveBeenCalledWith({
			portfolioId: { $in: ['p1', 'p2'] },
		});
	});

	it('sem carteira não consulta ativos', async () => {
		const asset = fakeModel();
		const usage = build({ Portfolio: fakeModel(), Asset: asset });

		expect(await usage.count('u1', 'assets')).toBe(0);
		expect(asset.countDocuments).not.toHaveBeenCalled();
	});

	it('model não registrado falha alto: contar zero liberaria a cota inteira', async () => {
		const usage = build({});

		await expect(usage.count('u1', 'portfolios')).rejects.toThrow(
			'Model Portfolio não registrado'
		);
	});
});
