import { Model } from 'mongoose';
import { MongoRiWatchMetricsReader } from 'src/ri-intelligence/watch/infrastructure/mongo-ri-watch-metrics.reader';
import { RiWatchDocumentSchema } from 'src/ri-intelligence/watch/infrastructure/ri-watch-document.model';

const SINCE = new Date('2026-09-03T15:00:00.000Z');

function exec<T>(value: T) {
	return { exec: jest.fn().mockResolvedValue(value) };
}

describe('MongoRiWatchMetricsReader (TRA-267)', () => {
	let model: {
		countDocuments: jest.Mock;
		aggregate: jest.Mock;
		find: jest.Mock;
	};
	let findChain: {
		sort: jest.Mock;
		limit: jest.Mock;
		select: jest.Mock;
		lean: jest.Mock;
	};

	beforeEach(() => {
		model = {
			countDocuments: jest.fn(() => exec(1)),
			aggregate: jest.fn((pipeline: Record<string, unknown>[]) =>
				'$group' in pipeline[1] &&
				(pipeline[1].$group as { _id: unknown })._id === null
					? exec([{ aiCalls: 9, tokens: 48_000 }])
					: exec([
							{ _id: 'content_empty_after_extract', count: 3 },
							{ _id: null, count: 1 },
						])
			),
			find: jest.fn(),
		};
		findChain = {
			sort: jest.fn().mockReturnThis(),
			limit: jest.fn().mockReturnThis(),
			select: jest.fn().mockReturnThis(),
			lean: jest.fn().mockResolvedValue([
				{
					ticker: 'PETR4',
					documentType: 'material_fact',
					record: { title: 'Fato Relevante - Aquisição' },
					publishedAt: new Date('2026-09-28T00:00:00.000Z'),
					status: 'failed',
					lastError: 'content_fetch_failed',
					attempts: 3,
					processedAt: new Date('2026-09-29T15:00:00.000Z'),
				},
			]),
		};
		model.find.mockReturnValue(findChain);
	});

	const read = () =>
		new MongoRiWatchMetricsReader(
			model as unknown as Model<RiWatchDocumentSchema>
		).read(SINCE);

	it('counts the queues, the totals and the window', async () => {
		const snapshot = await read();

		expect(snapshot.queue).toEqual({
			pending: 1,
			awaitingNotification: 1,
			awaitingIndex: 1,
		});
		expect(snapshot.totals.summarized).toBe(1);
		expect(model.countDocuments).toHaveBeenCalledWith({
			status: 'summarized',
			processedAt: { $gte: SINCE },
		});
		expect(model.countDocuments).toHaveBeenCalledWith({
			discoveredAt: { $gte: SINCE },
		});
		expect(model.countDocuments).toHaveBeenCalledWith({
			notifiedAt: { $ne: null },
		});
		expect(model.countDocuments).toHaveBeenCalledWith({
			status: { $in: ['summarized', 'skipped', 'failed'] },
			indexedAt: null,
		});
	});

	it('lists the failure reasons, naming the empty one', async () => {
		const { failureReasons } = await read();

		expect(failureReasons).toEqual([
			{ reason: 'content_empty_after_extract', count: 3 },
			{ reason: 'unknown', count: 1 },
		]);
	});

	it('shows the latest failures without any user data', async () => {
		const { recentFailures } = await read();

		expect(recentFailures).toEqual([
			{
				ticker: 'PETR4',
				documentType: 'material_fact',
				title: 'Fato Relevante - Aquisição',
				publishedAt: '2026-09-28T00:00:00.000Z',
				status: 'failed',
				reason: 'content_fetch_failed',
				attempts: 3,
				processedAt: '2026-09-29T15:00:00.000Z',
			},
		]);
		expect(findChain.select.mock.calls[0][0]).not.toMatch(/notification/);
	});

	it('sums the AI spent by the summaries of the window', async () => {
		expect((await read()).usage).toEqual({ aiCalls: 9, tokens: 48_000 });
	});

	it('reports zero usage on an empty window', async () => {
		model.aggregate.mockImplementation(() => exec([]));

		expect((await read()).usage).toEqual({ aiCalls: 0, tokens: 0 });
	});
});
