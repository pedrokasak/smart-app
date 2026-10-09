import { PortfolioHistoryRepairScheduler } from './portfolio-history-repair.scheduler';

describe('PortfolioHistoryRepairScheduler (TRA-279)', () => {
	const makeScheduler = (params: {
		owners: { _id: string; userId: string }[];
		backfill?: jest.Mock;
	}) => {
		const historyModel = {
			aggregate: jest.fn().mockResolvedValue(params.owners),
		};
		const backfill =
			params.backfill ??
			jest.fn().mockResolvedValue({ replaced: 3, covered: true });
		const scheduler = new PortfolioHistoryRepairScheduler(
			historyModel as any,
			{ backfill } as any
		);
		return { scheduler, historyModel, backfill };
	};

	it('só procura carteiras com ponto gravado a custo', async () => {
		const { scheduler, historyModel } = makeScheduler({ owners: [] });

		await scheduler.repair();

		const [pipeline] = historyModel.aggregate.mock.calls[0];
		expect(pipeline[0].$match).toEqual({
			$or: [{ stale: true }, { investedValue: { $exists: false } }],
		});
	});

	it('sem pendência, não reconstrói nada', async () => {
		const { scheduler, backfill } = makeScheduler({ owners: [] });

		await expect(scheduler.repair()).resolves.toEqual({
			pending: 0,
			attempted: 0,
			replaced: 0,
			failed: 0,
		});
		expect(backfill).not.toHaveBeenCalled();
	});

	it('reconstrói cada carteira com o dono certo e soma os pontos corrigidos', async () => {
		const { scheduler, backfill } = makeScheduler({
			owners: [
				{ _id: 'p2', userId: 'u2' },
				{ _id: 'p1', userId: 'u1' },
			],
		});

		const result = await scheduler.repair();

		expect(backfill).toHaveBeenCalledWith({ userId: 'u1', portfolioId: 'p1' });
		expect(backfill).toHaveBeenCalledWith({ userId: 'u2', portfolioId: 'p2' });
		expect(result).toEqual({
			pending: 2,
			attempted: 2,
			replaced: 6,
			failed: 0,
		});
	});

	it('falha de uma carteira não derruba as outras', async () => {
		const backfill = jest
			.fn()
			.mockRejectedValueOnce(new Error('fonte fora'))
			.mockResolvedValueOnce({ replaced: 4, covered: true });
		const { scheduler } = makeScheduler({
			owners: [
				{ _id: 'p1', userId: 'u1' },
				{ _id: 'p2', userId: 'u2' },
			],
			backfill,
		});

		const result = await scheduler.repair();

		expect(result).toMatchObject({ attempted: 2, replaced: 4, failed: 1 });
	});

	it('limita o lote e roda a fila entre os dias', async () => {
		const owners = ['p1', 'p2', 'p3'].map((id) => ({ _id: id, userId: 'u' }));
		const { scheduler, backfill } = makeScheduler({ owners });

		const day = new Date('2026-10-09T08:30:00Z');
		await scheduler.repair(2, day);
		const first = backfill.mock.calls.map(([arg]) => arg.portfolioId);
		backfill.mockClear();
		await scheduler.repair(2, new Date(day.getTime() + 24 * 60 * 60 * 1000));
		const second = backfill.mock.calls.map(([arg]) => arg.portfolioId);

		expect(first).toHaveLength(2);
		expect(second).toHaveLength(2);
		expect(second).not.toEqual(first);
	});

	it('runDaily não lança mesmo se a consulta falhar', async () => {
		const { scheduler, historyModel } = makeScheduler({ owners: [] });
		historyModel.aggregate.mockRejectedValueOnce(new Error('mongo fora'));

		await expect(scheduler.runDaily()).resolves.toBeUndefined();
	});
});
