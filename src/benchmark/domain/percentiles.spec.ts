import {
	percentile,
	roundReturnPp,
	roundScore,
} from 'src/benchmark/domain/percentiles';

describe('percentiles and rounding (ADR-003)', () => {
	it('uses the nearest rank over sorted values', () => {
		const sorted = [10, 20, 30, 40];
		expect(percentile(sorted, 0.25)).toBe(10);
		expect(percentile(sorted, 0.5)).toBe(20);
		expect(percentile(sorted, 0.75)).toBe(30);
		expect(percentile(sorted, 1)).toBe(40);
	});

	it('handles a single value and no value', () => {
		expect(percentile([7], 0.5)).toBe(7);
		expect(percentile([], 0.5)).toBeNaN();
	});

	it('rounds the score to an integer and the return to steps of 0.5 p.p.', () => {
		expect(roundScore(62.4)).toBe(62);
		expect(roundScore(62.5)).toBe(63);
		expect(roundReturnPp(0.1234)).toBe(12.5);
		expect(roundReturnPp(0.1224)).toBe(12);
		expect(roundReturnPp(-0.0376)).toBe(-4);
	});
});
