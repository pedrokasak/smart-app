import { MongoDailyCloseStore } from './mongo-daily-close.store';

function query<T>(result: T) {
	const chain: any = {
		select: () => chain,
		sort: () => chain,
		lean: () => chain,
		exec: async () => result,
		then: (resolve: (value: T) => unknown) => resolve(result),
	};
	return chain;
}

describe('MongoDailyCloseStore (TRA-251)', () => {
	const quote = {
		symbol: 'PETR4',
		date: '2026-10-07',
		open: 30,
		high: 31,
		low: 29,
		close: 30.5,
		volume: 1000,
		trades: 12,
	};

	function build(closes: any = {}, coverage: any = {}) {
		return {
			store: new MongoDailyCloseStore(closes, coverage),
			closes,
			coverage,
		};
	}

	it('regravar o mesmo (símbolo, dia) é upsert pela chave, não duplica', async () => {
		const bulkWrite = jest
			.fn()
			.mockResolvedValue({ upsertedCount: 1, modifiedCount: 1 });
		const { store } = build({ bulkWrite });

		const written = await store.upsertMany([
			quote,
			{ ...quote, symbol: 'VALE3' },
		]);

		expect(written).toBe(2);
		const [operations, options] = bulkWrite.mock.calls[0];
		expect(operations[0].updateOne).toMatchObject({
			filter: { symbol: 'PETR4', date: '2026-10-07' },
			upsert: true,
		});
		expect(options).toEqual({ ordered: false });
	});

	it('lista vazia não vai ao banco', async () => {
		const bulkWrite = jest.fn();
		const { store } = build({ bulkWrite });

		expect(await store.upsertMany([])).toBe(0);
		expect(bulkWrite).not.toHaveBeenCalled();
	});

	it('find devolve data e fechamento em ordem, a partir da data pedida', async () => {
		const find = jest.fn().mockReturnValue(
			query([
				{ date: '2026-10-05', close: 30 },
				{ date: '2026-10-06', close: 31 },
			])
		);
		const { store } = build({ find });

		expect(await store.find('petr4', '2026-10-01')).toEqual([
			{ date: '2026-10-05', close: 30 },
			{ date: '2026-10-06', close: 31 },
		]);
		expect(find).toHaveBeenCalledWith({
			symbol: 'PETR4',
			date: { $gte: '2026-10-01' },
		});
	});

	it('latestDate devolve null sem nenhuma cotação', async () => {
		const { store } = build({ findOne: () => query(null) });

		expect(await store.latestDate()).toBeNull();
	});

	it('coveredYears agrupa os anos por símbolo', async () => {
		const { store } = build(
			{},
			{
				find: () =>
					query([
						{ symbol: 'PETR4', year: 2025 },
						{ symbol: 'PETR4', year: 2026 },
						{ symbol: 'VALE3', year: 2026 },
					]),
			}
		);

		const covered = await store.coveredYears(
			['PETR4', 'VALE3'],
			2026,
			new Date('2026-09-23')
		);

		expect([...(covered.get('PETR4') ?? [])]).toEqual([2025, 2026]);
		expect([...(covered.get('VALE3') ?? [])]).toEqual([2026]);
	});

	it('cobertura do ano corrente velha demais não conta; a de anos fechados sempre conta', async () => {
		const find = jest.fn().mockReturnValue(query([]));
		const { store } = build({}, { find });
		const staleBefore = new Date('2026-09-23');

		await store.coveredYears(['PETR4'], 2026, staleBefore);

		expect(find).toHaveBeenCalledWith({
			symbol: { $in: ['PETR4'] },
			$or: [{ year: { $lt: 2026 } }, { coveredAt: { $gte: staleBefore } }],
		});
	});

	it('markCovered grava um registro por símbolo, idempotente', async () => {
		const bulkWrite = jest.fn().mockResolvedValue({});
		const { store } = build({}, { bulkWrite });

		await store.markCovered(['PETR4', 'VALE3'], 2026);

		const [operations] = bulkWrite.mock.calls[0];
		expect(operations).toHaveLength(2);
		expect(operations[0].updateOne.filter).toEqual({
			symbol: 'PETR4',
			year: 2026,
		});
		expect(operations[0].updateOne.upsert).toBe(true);
	});
});
