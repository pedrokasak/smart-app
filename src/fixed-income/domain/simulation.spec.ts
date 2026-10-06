import type { Instrument } from './instrument';
import { addDays } from './dates';
import { type Scenario, daysFromYears, simulateInstrument } from './simulation';

const scenario3y: Scenario = {
	principal: 10_000,
	years: 3,
	days: 1095,
	cdiPct: 13.65,
	ipcaPct: 4.5,
	horizonEnd: '2029-10-05',
};

const instrument = (overrides: Partial<Instrument>): Instrument => ({
	id: 'x',
	name: 'x',
	kind: 'CDB',
	family: 'BANK',
	indexer: 'PERCENT_CDI',
	ratePct: 100,
	...overrides,
});

describe('simulateInstrument', () => {
	it('CDB a 110% do CDI: IR de 15% sobre o ganho total, depois anualiza', () => {
		const row = simulateInstrument(
			instrument({ kind: 'CDB', ratePct: 110 }),
			scenario3y
		);
		expect(row.exempt).toBe(false);
		expect(row.irRatePct).toBe(15);
		expect(row.grossAnnualPct).toBeCloseTo(15.11312, 4);
		expect(row.grossFinal).toBeCloseTo(15253.6753, 3);
		expect(row.taxAmount).toBeCloseTo(788.0513, 3);
		expect(row.netFinal).toBeCloseTo(14465.624, 3);
		expect(row.netAnnualPct).toBeCloseTo(13.0956, 4);
		expect(row.taxDragPp).toBeCloseTo(15.11312 - 13.0956, 3);
		expect(row.realAnnualPct).toBeCloseTo(8.2255, 4);
		expect(row.tag).toBe('Crédito bancário');
	});

	it('LCI a 95% do CDI é isenta: líquido igual ao bruto', () => {
		const row = simulateInstrument(
			instrument({ kind: 'LCI', ratePct: 95 }),
			scenario3y
		);
		expect(row.exempt).toBe(true);
		expect(row.irRatePct).toBe(0);
		expect(row.taxAmount).toBe(0);
		expect(row.netFinal).toBeCloseTo(14400.4119, 3);
		expect(row.netAnnualPct).toBeCloseTo(row.grossAnnualPct, 8);
		expect(row.realAnnualPct).toBeCloseTo(8.0626, 4);
		expect(row.tag).toBe('Isento de IR');
	});

	it('IPCA + 7,55% multiplica os fatores e desconta o IR do Tesouro', () => {
		const row = simulateInstrument(
			instrument({
				kind: 'TESOURO',
				family: 'TESOURO',
				indexer: 'IPCA_PLUS',
				ratePct: 7.55,
				maturityDate: '2029-10-20',
			}),
			scenario3y
		);
		expect(row.grossAnnualPct).toBeCloseTo(12.38975, 5);
		expect(row.netFinal).toBeCloseTo(13566.9925, 3);
		expect(row.realAnnualPct).toBeCloseTo(5.9363, 4);
		expect(row.tag).toBe('Protege da inflação');
	});

	it('prefixado usa a taxa contratada, não depende do CDI nem do IPCA', () => {
		const row = simulateInstrument(
			instrument({
				kind: 'TESOURO',
				family: 'TESOURO',
				indexer: 'PREFIXED',
				ratePct: 14.07,
			}),
			{ ...scenario3y, cdiPct: 8, ipcaPct: 9 }
		);
		expect(row.grossAnnualPct).toBe(14.07);
		expect(row.tag).toBe('Travar taxa');
	});

	it('Tesouro Selic rende CDI + spread', () => {
		const row = simulateInstrument(
			instrument({
				kind: 'TESOURO',
				family: 'TESOURO',
				indexer: 'CDI_PLUS',
				ratePct: 0.09,
			}),
			scenario3y
		);
		expect(row.grossAnnualPct).toBeCloseTo(13.752285, 5);
		expect(row.tag).toBe('Liquidez diária');
	});

	it('a faixa do IR segue os dias corridos do prazo', () => {
		const at = (days: number) =>
			simulateInstrument(instrument({ ratePct: 100 }), {
				...scenario3y,
				years: days / 365,
				days,
			}).irRatePct;
		expect(at(180)).toBe(22.5);
		expect(at(181)).toBe(20);
		expect(at(721)).toBe(15);
	});

	it('avisa sobre marcação a mercado quando o título vence bem depois do prazo', () => {
		const long = simulateInstrument(
			instrument({
				kind: 'TESOURO',
				family: 'TESOURO',
				indexer: 'PREFIXED',
				ratePct: 14.07,
				maturityDate: '2031-01-01',
			}),
			scenario3y
		);
		expect(long.note).toContain('2031');
		expect(long.note).toContain('marcação a mercado');

		const near = simulateInstrument(
			instrument({
				kind: 'TESOURO',
				family: 'TESOURO',
				indexer: 'PREFIXED',
				ratePct: 14.07,
				maturityDate: '2029-10-20',
			}),
			scenario3y
		);
		expect(near.note).toBeUndefined();
	});

	it('Tesouro Selic nunca recebe aviso de marcação a mercado', () => {
		const row = simulateInstrument(
			instrument({
				kind: 'TESOURO',
				family: 'TESOURO',
				indexer: 'CDI_PLUS',
				ratePct: 0.09,
				maturityDate: '2035-03-01',
			}),
			scenario3y
		);
		expect(row.note).toBeUndefined();
	});
});

describe('prazo', () => {
	it('converte anos em dias corridos', () => {
		expect(daysFromYears(3)).toBe(1095);
		expect(daysFromYears(0.5)).toBe(183);
	});

	it('soma dias a uma data ISO sem depender de fuso', () => {
		expect(addDays('2026-10-05', 1095)).toBe('2029-10-04');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
	});
});
