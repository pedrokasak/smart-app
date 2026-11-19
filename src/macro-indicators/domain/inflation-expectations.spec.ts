import {
	type InflationExpectations,
	expectedAnnualIpcaPct,
} from './inflation-expectations';

const focus: InflationExpectations = {
	surveyDate: '2026-10-09',
	next12mPct: 4.48,
	byYear: { 2026: 5.22, 2027: 4.3, 2028: 3.79, 2029: 3.5, 2030: 3.5 },
	source: 'BCB_FOCUS',
};

describe('expectedAnnualIpcaPct', () => {
	it('até 12 meses usa a projeção dos próximos 12 meses', () => {
		expect(expectedAnnualIpcaPct(focus, '2026-10-14', 180)).toBeCloseTo(
			4.48,
			6
		);
		expect(expectedAnnualIpcaPct(focus, '2026-10-14', 365)).toBeCloseTo(
			4.48,
			6
		);
	});

	it('depois do primeiro ano, compõe a mediana de cada ano-calendário', () => {
		// 365 dias a 4,48% + 365 dias que caem em 2027 (79) e 2028 (286).
		const growth =
			1.0448 * Math.pow(1.043, 79 / 365) * Math.pow(1.0379, 286 / 365);
		const expected = (Math.pow(growth, 365 / 730) - 1) * 100;

		expect(expectedAnnualIpcaPct(focus, '2026-10-14', 730)).toBeCloseTo(
			expected,
			6
		);
	});

	it('além do último ano do Focus, repete o último ano publicado', () => {
		const tenYears = expectedAnnualIpcaPct(focus, '2026-10-14', 3650);
		expect(tenYears).toBeGreaterThan(3.5);
		expect(tenYears).toBeLessThan(3.8);
	});

	it('prazo zero devolve a projeção de 12 meses', () => {
		expect(expectedAnnualIpcaPct(focus, '2026-10-14', 0)).toBe(4.48);
	});
});
