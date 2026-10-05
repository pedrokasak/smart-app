import { Model } from 'mongoose';
import { MongoAiEvalReportStore } from 'src/ai/evaluation/infrastructure/mongo-ai-eval-report.store';

const REPORT = {
	rubric_version: '2026-10-v1',
	judge_provider: 'gemini',
	prompt_fingerprint: 'abc',
	totals: { evaluated: 3 },
	by_route: {},
	by_intent: {},
	guard: {},
};

function findChain<T>(value: T) {
	return {
		sort: jest.fn().mockReturnThis(),
		limit: jest.fn().mockReturnThis(),
		lean: jest.fn().mockReturnThis(),
		exec: jest.fn().mockResolvedValue(value),
	};
}

describe('MongoAiEvalReportStore (TRA-268)', () => {
	let query: ReturnType<typeof findChain>;
	let model: { find: jest.Mock };

	const store = () =>
		new MongoAiEvalReportStore(model as unknown as Model<never>);

	beforeEach(() => {
		query = findChain([
			{
				_id: 'r2',
				createdAt: new Date('2026-10-05T09:00:00.000Z'),
				windowDays: 7,
				chatSamples: 60,
				report: REPORT,
				regressions: [],
			},
			{
				_id: 'r1',
				createdAt: new Date('2026-09-28T09:00:00.000Z'),
				windowDays: 7,
				chatSamples: 55,
				report: REPORT,
			},
		]);
		model = { find: jest.fn(() => query) };
	});

	it('returns the newest reports first, without the Mongo id', async () => {
		const reports = await store().recent(2);

		expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
		expect(query.limit).toHaveBeenCalledWith(2);
		expect(reports).toEqual([
			{
				createdAt: '2026-10-05T09:00:00.000Z',
				windowDays: 7,
				chatSamples: 60,
				report: REPORT,
				regressions: [],
			},
			{
				createdAt: '2026-09-28T09:00:00.000Z',
				windowDays: 7,
				chatSamples: 55,
				report: REPORT,
				regressions: [],
			},
		]);
	});

	// No Mongo, limit(0) é "sem limite".
	it('returns nothing for a zero limit instead of every report', async () => {
		await expect(store().recent(0)).resolves.toEqual([]);
		expect(model.find).not.toHaveBeenCalled();
	});

	it('reads the latest report through the same query', async () => {
		await expect(store().latest()).resolves.toMatchObject({
			createdAt: '2026-10-05T09:00:00.000Z',
		});
		expect(query.limit).toHaveBeenCalledWith(1);

		query.exec.mockResolvedValue([]);
		await expect(store().latest()).resolves.toBeNull();
	});
});
