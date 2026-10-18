import { UserCohortSourceAdapter } from 'src/benchmark/infrastructure/user-cohort-source.adapter';

const NOW = new Date('2026-10-17T12:00:00.000Z');

/** Série diária de 200 dias úteis corridos, valorizando 0,1% ao dia. */
function dailySeries(days: number, start = '2025-12-01', startValue = 10000) {
	const base = new Date(`${start}T00:00:00.000Z`).getTime();
	return Array.from({ length: days }, (_, i) => ({
		date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
		totalValue: startValue * Math.pow(1.001, i),
		investedValue: startValue,
		tradingDay: true,
		staleSymbols: [],
	}));
}

const query = <T>(rows: T[]) => ({
	sort: () => ({ lean: () => ({ exec: () => Promise.resolve(rows) }) }),
});

describe('UserCohortSourceAdapter (ADR-003, TRA-60)', () => {
	let history: { find: jest.Mock };
	let trades: { find: jest.Mock };
	let portfolios: { getUserPortfolios: jest.Mock };
	let profile: { getEffectiveProfile: jest.Mock };
	let intelligence: { getPortfolioSummary: jest.Mock };
	let adapter: UserCohortSourceAdapter;

	beforeEach(() => {
		history = { find: jest.fn().mockReturnValue(query(dailySeries(320))) };
		trades = {
			find: jest.fn().mockReturnValue(
				query([
					{
						symbol: 'PETR4',
						side: 'buy',
						quantity: 100,
						price: 100,
						fees: 0,
						date: new Date('2025-12-01T00:00:00.000Z'),
					},
				])
			),
		};
		portfolios = {
			getUserPortfolios: jest.fn().mockResolvedValue([
				{
					assets: [
						{ symbol: 'PETR4', type: 'stock', quantity: 100, total: 10000 },
					],
				},
			]),
		};
		profile = {
			getEffectiveProfile: jest
				.fn()
				.mockResolvedValue({ sophistication: 'intermediate' }),
		};
		intelligence = {
			getPortfolioSummary: jest
				.fn()
				.mockReturnValue({ diversification: { score: 61.7 } }),
		};
		adapter = new UserCohortSourceAdapter(
			{} as never,
			history as never,
			trades as never,
			portfolios as never,
			profile as never,
			intelligence as never
		);
	});

	it('builds an anonymous member from the portfolio of that one user', async () => {
		const result = await adapter.memberFor('u1', NOW);

		expect(result.eligible).toBe(true);
		const { member } = result as any;
		expect(Object.keys(member).sort()).toEqual([
			'diversificationScore',
			'level',
			'return12m',
			'wealthBand',
		]);
		expect(member.level).toBe('intermediate');
		expect(member.wealthBand).toBe('upto_50k');
		expect(member.diversificationScore).toBeCloseTo(61.7);
		expect(member.return12m as number).toBeGreaterThan(0);
		expect(history.find).toHaveBeenCalledWith({ userId: 'u1' });
		expect(trades.find).toHaveBeenCalledWith({ userId: 'u1' });
	});

	it('puts a large portfolio in the top wealth band', async () => {
		history.find.mockReturnValue(query(dailySeries(320, '2025-12-01', 400000)));

		const result = await adapter.memberFor('u1', NOW);

		expect((result as any).member.wealthBand).toBe('above_250k');
	});

	it('leaves out a portfolio with less than 6 months of history', async () => {
		history.find.mockReturnValue(query(dailySeries(60, '2026-08-15')));

		expect(await adapter.memberFor('u1', NOW)).toEqual({
			eligible: false,
			reason: 'short_history',
		});
	});

	it('leaves out a user without positions', async () => {
		portfolios.getUserPortfolios.mockResolvedValue([{ assets: [] }]);

		expect(await adapter.memberFor('u1', NOW)).toEqual({
			eligible: false,
			reason: 'no_portfolio',
		});
		expect(history.find).not.toHaveBeenCalled();
	});

	it('leaves out a user without a return series', async () => {
		history.find.mockReturnValue(query([]));

		expect(await adapter.memberFor('u1', NOW)).toEqual({
			eligible: false,
			reason: 'no_return_series',
		});
	});

	it('leaves out a portfolio whose score cannot be computed', async () => {
		intelligence.getPortfolioSummary.mockReturnValue({ diversification: null });

		expect(await adapter.memberFor('u1', NOW)).toEqual({
			eligible: false,
			reason: 'no_portfolio',
		});
	});

	it('streams eligible members only and survives a user that throws', async () => {
		const cursor = (async function* () {
			yield { _id: 'u1' };
			yield { _id: 'u2' };
			yield { _id: 'u3' };
		})();
		const userModel = {
			find: () => ({ lean: () => ({ cursor: () => cursor }) }),
		};
		adapter = new UserCohortSourceAdapter(
			userModel as never,
			history as never,
			trades as never,
			portfolios as never,
			profile as never,
			intelligence as never
		);
		portfolios.getUserPortfolios
			.mockResolvedValueOnce([{ assets: [] }])
			.mockRejectedValueOnce(new Error('dado ruim'))
			.mockResolvedValue([
				{
					assets: [
						{ symbol: 'PETR4', type: 'stock', quantity: 100, total: 10000 },
					],
				},
			]);

		const found: unknown[] = [];
		for await (const member of adapter.members()) found.push(member);

		expect(found).toHaveLength(1);
		expect(Object.keys(found[0] as object)).not.toContain('userId');
	});
});
