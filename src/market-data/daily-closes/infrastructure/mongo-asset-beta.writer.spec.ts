import { MongoAssetBetaWriter } from './mongo-asset-beta.writer';

describe('MongoAssetBetaWriter (TRA-251)', () => {
	it('grava beta, pregão e benchmark em campos próprios, só em ativo listado', async () => {
		const bulkWrite = jest.fn().mockResolvedValue({ modifiedCount: 3 });
		const writer = new MongoAssetBetaWriter({ bulkWrite } as any);

		const updated = await writer.write([
			{ symbol: 'PETR4', beta: 1.2, asOf: '2026-10-06', benchmark: 'BOVA11' },
		]);

		expect(updated).toBe(3);
		const [operations, options] = bulkWrite.mock.calls[0];
		expect(operations[0].updateMany).toEqual({
			filter: { symbol: 'PETR4', type: { $in: ['stock', 'fii', 'etf'] } },
			update: {
				$set: { beta: 1.2, betaAsOf: '2026-10-06', betaBenchmark: 'BOVA11' },
			},
		});
		expect(options).toEqual({ ordered: false });
	});

	it('beta nulo é gravado (limpa um valor antigo sem histórico suficiente)', async () => {
		const bulkWrite = jest.fn().mockResolvedValue({ modifiedCount: 1 });
		const writer = new MongoAssetBetaWriter({ bulkWrite } as any);

		await writer.write([
			{ symbol: 'NOVO3', beta: null, asOf: null, benchmark: 'BOVA11' },
		]);

		expect(
			bulkWrite.mock.calls[0][0][0].updateMany.update.$set.beta
		).toBeNull();
	});

	it('lista vazia não vai ao banco', async () => {
		const bulkWrite = jest.fn();

		expect(await new MongoAssetBetaWriter({ bulkWrite } as any).write([])).toBe(
			0
		);
		expect(bulkWrite).not.toHaveBeenCalled();
	});
});
