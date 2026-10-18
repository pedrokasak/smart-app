import { aggregateCohorts } from 'src/benchmark/domain/cohort-aggregation';
import {
	COHORT_MIN_MEMBERS,
	type CohortLevel,
	type CohortMember,
	type WealthBand,
} from 'src/benchmark/domain/cohort';

const members = (
	count: number,
	level: CohortLevel,
	wealthBand: WealthBand,
	score = (i: number) => 40 + (i % 50),
	ret = (i: number) => 0.05 + (i % 20) / 100
): CohortMember[] =>
	Array.from({ length: count }, (_, i) => ({
		level,
		wealthBand,
		diversificationScore: score(i),
		return12m: ret(i),
	}));

describe('aggregateCohorts: k-anonymity and rounding (ADR-003, TRA-60)', () => {
	it('publishes a cohort that reaches k, with rounded percentiles', () => {
		const [cohort] = aggregateCohorts(
			members(
				100,
				'beginner',
				'upto_50k',
				(i) => i + 0.4,
				(i) => i / 1000
			)
		);

		expect(cohort.level).toBe('beginner');
		expect(cohort.wealthBands).toEqual(['upto_50k']);
		// nearest rank sobre 0.4..99.4 (índices 24, 49, 74), depois inteiro
		expect(cohort.score).toEqual({ p25: 24, p50: 49, p75: 74 });
		// 0.024 -> 2.4 p.p. -> passo de 0,5 = 2.5
		expect(cohort.return12mPp).toEqual({ p25: 2.5, p50: 5, p75: 7.5 });
	});

	it('NEVER publishes a cohort below k, even when nothing can be merged', () => {
		expect(
			aggregateCohorts(members(COHORT_MIN_MEMBERS - 1, 'beginner', 'upto_50k'))
		).toEqual([]);
	});

	it('publishes exactly at k', () => {
		expect(
			aggregateCohorts(members(COHORT_MIN_MEMBERS, 'beginner', 'upto_50k'))
		).toHaveLength(1);
	});

	it('merges a thin band into its neighbour of the same level', () => {
		const result = aggregateCohorts([
			...members(30, 'intermediate', 'upto_50k'),
			...members(80, 'intermediate', '50k_250k'),
		]);

		expect(result).toHaveLength(1);
		expect(result[0].wealthBands).toEqual(['upto_50k', '50k_250k']);
		expect(result[0].sampleSizeBucket).toBe(110);
	});

	it('merges the low band into the middle, never skipping over it', () => {
		const result = aggregateCohorts([
			...members(20, 'experienced', 'upto_50k'),
			...members(30, 'experienced', '50k_250k'),
			...members(60, 'experienced', 'above_250k'),
		]);

		// 20 + 30 = 50 (publica) ; 60 sozinha (publica).
		expect(result.map((c) => c.wealthBands)).toEqual([
			['upto_50k', '50k_250k'],
			['above_250k'],
		]);
	});

	it('merges all three bands when each one alone is too thin', () => {
		const result = aggregateCohorts([
			...members(20, 'beginner', 'upto_50k'),
			...members(20, 'beginner', '50k_250k'),
			...members(20, 'beginner', 'above_250k'),
		]);

		expect(result).toHaveLength(1);
		expect(result[0].wealthBands).toEqual([
			'upto_50k',
			'50k_250k',
			'above_250k',
		]);
	});

	it('never merges across levels', () => {
		const result = aggregateCohorts([
			...members(30, 'beginner', 'upto_50k'),
			...members(30, 'intermediate', 'upto_50k'),
		]);

		expect(result).toEqual([]);
	});

	it('keeps levels independent of each other', () => {
		const result = aggregateCohorts([
			...members(60, 'beginner', 'upto_50k'),
			...members(60, 'experienced', 'above_250k'),
		]);

		expect(result.map((c) => c.level)).toEqual(['beginner', 'experienced']);
	});

	it('rounds the sample size down to a multiple of 10', () => {
		const [cohort] = aggregateCohorts(members(57, 'beginner', 'upto_50k'));
		expect(cohort.sampleSizeBucket).toBe(50);
	});

	it('ignores members with a non-finite score or return', () => {
		const result = aggregateCohorts([
			...members(50, 'beginner', 'upto_50k'),
			{
				level: 'beginner',
				wealthBand: 'upto_50k',
				diversificationScore: NaN,
				return12m: 0.1,
			},
			{
				level: 'beginner',
				wealthBand: 'upto_50k',
				diversificationScore: 50,
				return12m: Infinity,
			},
		]);

		expect(result).toHaveLength(1);
		expect(result[0].sampleSizeBucket).toBe(50);
	});

	it('publishes only aggregate fields: nothing points to a person', () => {
		const [cohort] = aggregateCohorts(members(60, 'beginner', 'upto_50k'));

		expect(Object.keys(cohort).sort()).toEqual([
			'level',
			'return12mPp',
			'sampleSizeBucket',
			'score',
			'wealthBands',
		]);
		expect(JSON.stringify(cohort)).not.toMatch(/user|email|portfolioId|_id/i);
	});

	it('returns nothing without members', () => {
		expect(aggregateCohorts([])).toEqual([]);
	});

	it('lets one outlier move the median by at most one rank', () => {
		const base = members(100, 'beginner', 'upto_50k', (i) => 40 + (i % 30));
		const withOutlier = [
			...base.slice(1),
			{ ...base[0], diversificationScore: 99, return12m: 3 },
		];

		const a = aggregateCohorts(base)[0];
		const b = aggregateCohorts(withOutlier)[0];

		expect(Math.abs(a.score.p50 - b.score.p50)).toBeLessThanOrEqual(1);
		expect(Math.abs(a.return12mPp.p50 - b.return12mPp.p50)).toBeLessThanOrEqual(
			1
		);
	});
});
