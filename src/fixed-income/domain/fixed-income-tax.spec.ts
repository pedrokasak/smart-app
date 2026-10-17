import {
	iofRatePct,
	isTaxExempt,
	regressiveTaxRatePct,
} from './fixed-income-tax';

describe('fixed-income-tax', () => {
	it.each([
		[1, 22.5],
		[180, 22.5],
		[181, 20],
		[360, 20],
		[361, 17.5],
		[720, 17.5],
		[721, 15],
		[3650, 15],
	])('IR regressivo: %i dias corridos → %d%%', (days, expected) => {
		expect(regressiveTaxRatePct(days)).toBe(expected);
	});

	it('LCI, LCA, CRI, CRA e debênture incentivada são isentos; CDB e Tesouro não', () => {
		for (const kind of [
			'LCI',
			'LCA',
			'CRI',
			'CRA',
			'DEBENTURE_INCENTIVADA',
		] as const) {
			expect(isTaxExempt(kind)).toBe(true);
		}
		for (const kind of [
			'CDB',
			'LC',
			'DEBENTURE',
			'TESOURO',
			'REFERENCIA',
		] as const) {
			expect(isTaxExempt(kind)).toBe(false);
		}
	});
});

describe('iofRatePct (TRA-230)', () => {
	it('segue a tabela regressiva e zera no 30º dia', () => {
		expect(iofRatePct(0)).toBe(0);
		expect(iofRatePct(1)).toBe(96);
		expect(iofRatePct(14)).toBe(53);
		expect(iofRatePct(29)).toBe(3);
		expect(iofRatePct(30)).toBe(0);
		expect(iofRatePct(400)).toBe(0);
	});
});
