import {
	BENCHMARK_RETENTION_MONTHS,
	MongoCohortBenchmarkStore,
} from 'src/benchmark/infrastructure/mongo-cohort-benchmark.store';
import type { CohortBenchmark } from 'src/benchmark/domain/cohort';

const benchmark: CohortBenchmark = {
	level: 'beginner',
	wealthBands: ['upto_50k', '50k_250k'],
	sampleSizeBucket: 120,
	score: { p25: 40, p50: 55, p75: 70 },
	return12mPp: { p25: 5, p50: 9, p75: 14 },
};

describe('MongoCohortBenchmarkStore (ADR-003, TRA-60)', () => {
	let model: {
		deleteMany: jest.Mock;
		insertMany: jest.Mock;
		findOne: jest.Mock;
	};
	let store: MongoCohortBenchmarkStore;

	beforeEach(() => {
		model = {
			deleteMany: jest.fn().mockResolvedValue({}),
			insertMany: jest.fn().mockResolvedValue([]),
			findOne: jest.fn(),
		};
		store = new MongoCohortBenchmarkStore(model as never);
	});

	it('replaces the period and stores only aggregate fields', async () => {
		await store.replacePeriod('2026-11', [benchmark]);

		expect(model.deleteMany).toHaveBeenNthCalledWith(1, { period: '2026-11' });
		const [docs] = model.insertMany.mock.calls[0];
		expect(docs).toHaveLength(1);
		expect(docs[0]).toMatchObject({
			period: '2026-11',
			key: 'beginner:upto_50k+50k_250k',
			level: 'beginner',
			wealthBands: ['upto_50k', '50k_250k'],
			sampleSizeBucket: 120,
		});
		expect(Object.keys(docs[0]).sort()).toEqual([
			'computedAt',
			'key',
			'level',
			'period',
			'return12mPp',
			'sampleSizeBucket',
			'score',
			'wealthBands',
		]);
	});

	it('skips the insert for an empty period but still clears the old rows', async () => {
		await store.replacePeriod('2026-11', []);

		expect(model.insertMany).not.toHaveBeenCalled();
		expect(model.deleteMany).toHaveBeenNthCalledWith(1, { period: '2026-11' });
	});

	it('drops periods older than the retention window, across a year boundary', async () => {
		expect(BENCHMARK_RETENTION_MONTHS).toBe(12);

		await store.replacePeriod('2026-03', [benchmark]);

		expect(model.deleteMany).toHaveBeenLastCalledWith({
			period: { $lt: '2025-03' },
		});
	});

	it('finds the newest published cohort that covers the band', async () => {
		const lean = jest.fn().mockResolvedValue({
			period: '2026-10',
			level: 'beginner',
			wealthBands: ['upto_50k', '50k_250k'],
			sampleSizeBucket: 120,
			score: benchmark.score,
			return12mPp: benchmark.return12mPp,
			_id: 'x',
			key: 'k',
			computedAt: new Date(),
		});
		const sort = jest.fn().mockReturnValue({ lean });
		model.findOne.mockReturnValue({ sort });

		const result = await store.latestFor('beginner', '50k_250k');

		expect(model.findOne).toHaveBeenCalledWith({
			level: 'beginner',
			wealthBands: '50k_250k',
		});
		expect(sort).toHaveBeenCalledWith({ period: -1 });
		expect(result).toEqual({ period: '2026-10', benchmark });
	});

	it('returns null when nothing covers the band', async () => {
		model.findOne.mockReturnValue({
			sort: () => ({ lean: () => Promise.resolve(null) }),
		});

		expect(await store.latestFor('beginner', 'above_250k')).toBeNull();
	});
});
