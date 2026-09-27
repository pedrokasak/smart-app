import {
	compoundPercent,
	inflationOverPeriod,
	realReturn,
} from './compounding';

describe('compoundPercent', () => {
	it('chains rates instead of summing them (0.58, 0.16, 0.07 → 0.8114, not 0.81)', () => {
		expect(compoundPercent([0.58, 0.16, 0.07])).toBeCloseTo(0.8114, 4);
		expect(compoundPercent([0.58, 0.16, 0.07])).not.toBeCloseTo(0.81, 4);
	});

	it('returns zero for no rates', () => {
		expect(compoundPercent([])).toBe(0);
	});
});

describe('realReturn', () => {
	it('deflates by Fisher, not by subtraction', () => {
		// 10% nominal com 5% de inflação é 4,76% real, não 5%.
		expect(realReturn(0.1, 0.05)).toBeCloseTo(0.047619, 6);
	});
});

describe('inflationOverPeriod', () => {
	const ipca = [
		{ date: '2026-04-01', value: 0.4 },
		{ date: '2026-05-01', value: 0.58 },
		{ date: '2026-06-01', value: 0.16 },
		{ date: '2026-07-01', value: 0.07 },
	];

	it('chains whole months exactly', () => {
		const result = inflationOverPeriod(ipca, '2026-05-01', '2026-08-01');

		expect(result?.inflation).toBeCloseTo(0.008114, 6);
		expect(result?.estimatedMonths).toBe(0);
		expect(result?.lastPublishedMonth).toBe('2026-07-01');
	});

	it('prorates a partial month geometrically by calendar days', () => {
		// 16 de 31 dias de maio.
		const result = inflationOverPeriod(ipca, '2026-05-16', '2026-06-01');

		expect(result?.inflation).toBeCloseTo(Math.pow(1.0058, 16 / 31) - 1, 10);
	});

	it('estimates unpublished months with the last published IPCA and says how many', () => {
		const result = inflationOverPeriod(ipca, '2026-07-01', '2026-09-16');

		// Julho publicado; agosto inteiro e metade de setembro estimados por 0,07%.
		const expected = 1.0007 * 1.0007 * Math.pow(1.0007, 15 / 30) - 1;
		expect(result?.inflation).toBeCloseTo(expected, 10);
		expect(result?.estimatedMonths).toBe(2);
		expect(result?.lastPublishedMonth).toBe('2026-07-01');
	});

	it('uses an IPCA published before the period when the first month is missing', () => {
		const result = inflationOverPeriod(
			[{ date: '2026-07-01', value: 0.07 }],
			'2026-08-10',
			'2026-08-20'
		);

		expect(result?.estimatedMonths).toBe(1);
		expect(result?.inflation).toBeCloseTo(Math.pow(1.0007, 10 / 31) - 1, 10);
	});

	it('returns null when there is no IPCA at or before the start', () => {
		expect(
			inflationOverPeriod(
				[{ date: '2026-07-01', value: 0.07 }],
				'2026-05-01',
				'2026-08-01'
			)
		).toBeNull();
	});

	it('returns null for an empty or inverted period', () => {
		expect(inflationOverPeriod(ipca, '2026-06-01', '2026-06-01')).toBeNull();
		expect(inflationOverPeriod(ipca, '2026-07-01', '2026-06-01')).toBeNull();
	});
});
