import { CohortBenchmarkService } from 'src/benchmark/application/cohort-benchmark.service';
import type {
	CohortBenchmark,
	CohortMember,
} from 'src/benchmark/domain/cohort';

const member = (overrides: Partial<CohortMember> = {}): CohortMember => ({
	level: 'beginner',
	wealthBand: 'upto_50k',
	diversificationScore: 62.4,
	return12m: 0.1234,
	...overrides,
});

const benchmark: CohortBenchmark = {
	level: 'beginner',
	wealthBands: ['upto_50k', '50k_250k'],
	sampleSizeBucket: 120,
	score: { p25: 40, p50: 55, p75: 70 },
	return12mPp: { p25: 5, p50: 9, p75: 14 },
};

async function* stream(items: CohortMember[]) {
	for (const item of items) yield item;
}

describe('CohortBenchmarkService (ADR-003, TRA-60)', () => {
	let source: { members: jest.Mock; memberFor: jest.Mock };
	let store: { replacePeriod: jest.Mock; latestFor: jest.Mock };
	let service: CohortBenchmarkService;

	beforeEach(() => {
		source = {
			members: jest.fn(),
			memberFor: jest.fn(),
		};
		store = {
			replacePeriod: jest.fn().mockResolvedValue(undefined),
			latestFor: jest.fn(),
		};
		service = new CohortBenchmarkService(source as never, store as never);
	});

	describe('publishPeriod', () => {
		it('aggregates the stream and stores only the aggregate for the month', async () => {
			source.members.mockReturnValue(
				stream(
					Array.from({ length: 60 }, (_, i) =>
						member({ diversificationScore: 30 + i, return12m: i / 100 })
					)
				)
			);

			const summary = await service.publishPeriod(
				new Date('2026-11-01T07:00:00Z')
			);

			expect(summary).toEqual({ members: 60, cohorts: 1 });
			expect(store.replacePeriod).toHaveBeenCalledTimes(1);
			const [period, stored] = store.replacePeriod.mock.calls[0];
			expect(period).toBe('2026-11');
			expect(stored).toHaveLength(1);
			expect(JSON.stringify(stored)).not.toMatch(/user|email|_id/i);
		});

		it('stores an empty period when no cohort reaches k, replacing the old one', async () => {
			source.members.mockReturnValue(stream([member(), member()]));

			const summary = await service.publishPeriod(
				new Date('2026-11-01T07:00:00Z')
			);

			expect(summary).toEqual({ members: 2, cohorts: 0 });
			expect(store.replacePeriod).toHaveBeenCalledWith('2026-11', []);
		});
	});

	describe('getForUser', () => {
		it('returns the cohort aggregate and where the person sits, in bands', async () => {
			source.memberFor.mockResolvedValue({ eligible: true, member: member() });
			store.latestFor.mockResolvedValue({ period: '2026-10', benchmark });

			const response = await service.getForUser('u1');

			expect(store.latestFor).toHaveBeenCalledWith('beginner', 'upto_50k');
			expect(response).toEqual({
				available: true,
				period: '2026-10',
				cohort: {
					level: 'beginner',
					wealthBands: ['upto_50k', '50k_250k'],
					sampleSizeBucket: 120,
				},
				score: {
					p25: 40,
					p50: 55,
					p75: 70,
					you: { value: 62, position: 'above_median' },
				},
				return12m: {
					p25: 5,
					p50: 9,
					p75: 14,
					you: { valuePp: 12.5, position: 'above_median' },
				},
				minHistoryMonths: 6,
			});
		});

		it('only ever reads the requester: the source is asked about that id alone', async () => {
			source.memberFor.mockResolvedValue({ eligible: true, member: member() });
			store.latestFor.mockResolvedValue({ period: '2026-10', benchmark });

			await service.getForUser('u1');

			expect(source.memberFor).toHaveBeenCalledTimes(1);
			expect(source.memberFor).toHaveBeenCalledWith('u1');
			expect(source.members).not.toHaveBeenCalled();
		});

		it.each(['no_portfolio', 'short_history', 'no_return_series'])(
			'explains why a person is out: %s',
			async (reason) => {
				source.memberFor.mockResolvedValue({ eligible: false, reason });

				const response = await service.getForUser('u1');

				expect(response).toEqual({
					available: false,
					reason,
					minHistoryMonths: 6,
				});
				expect(store.latestFor).not.toHaveBeenCalled();
			}
		);

		it('says the cohort is not published when none reached k', async () => {
			source.memberFor.mockResolvedValue({ eligible: true, member: member() });
			store.latestFor.mockResolvedValue(null);

			expect(await service.getForUser('u1')).toEqual({
				available: false,
				reason: 'cohort_not_published',
				minHistoryMonths: 6,
			});
		});
	});
});
