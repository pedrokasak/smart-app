import { PortfolioReturnsService } from './portfolio-returns.service';

const query = (rows: unknown[]) => {
	const chain: any = {
		sort: () => chain,
		lean: () => chain,
		select: () => chain,
		exec: async () => rows,
	};
	return chain;
};

describe('PortfolioReturnsService.getReturnsSummary', () => {
	const rows = [
		{ date: '2026-01-02', totalValue: 1000, investedValue: 1000 },
		{ date: '2026-01-03', totalValue: 1100, investedValue: 1000 },
		{ date: '2026-01-04', totalValue: 1210, investedValue: 1000, stale: true },
	];
	const trades = [
		{ side: 'buy', quantity: 10, price: 100, fees: 0, date: '2026-01-01' },
	];
	const marketData = { getDailyCloses: jest.fn().mockResolvedValue([]) };
	const riskFree = {
		getCdiSeries: jest.fn().mockResolvedValue({ series: [] }),
	};
	const inflation = {
		getMonthlyIpca: jest.fn().mockRejectedValue(new Error()),
	};
	const history = { find: jest.fn(() => query(rows)) };
	const service = new PortfolioReturnsService(
		history as any,
		{ find: jest.fn(() => query(trades)) } as any,
		marketData as any,
		riskFree as any,
		inflation as any,
		{ getUserPortfolios: jest.fn().mockResolvedValue([]) } as any
	);

	beforeEach(() => jest.clearAllMocks());

	it('não faz nenhuma chamada externa', async () => {
		await service.getReturnsSummary('u1');

		expect(marketData.getDailyCloses).not.toHaveBeenCalled();
		expect(riskFree.getCdiSeries).not.toHaveBeenCalled();
		expect(inflation.getMonthlyIpca).not.toHaveBeenCalled();
	});

	it('dá os mesmos números do cálculo completo', async () => {
		const summary = await service.getReturnsSummary('u1');
		const full = await service.getReturns('u1');

		expect(summary.currentValue).toBe(full.contribution.currentValue);
		expect(summary.twr).toBe(full.twr.value);
		expect(summary.asOf).toBe(full.to);
		expect(summary.staleDays).toBe(full.staleDays);
	});

	it('respeita o período pedido', async () => {
		await service.getReturnsSummary('u1', { from: '2026-01-03' });

		expect(history.find).toHaveBeenCalledWith({
			userId: 'u1',
			date: { $gte: '2026-01-03' },
		});
	});

	it('sem histórico, responde vazio em vez de falhar', async () => {
		history.find.mockReturnValueOnce(query([]));

		await expect(service.getReturnsSummary('u1')).resolves.toEqual({
			currentValue: 0,
			twr: null,
			asOf: null,
			staleDays: 0,
		});
	});
});
