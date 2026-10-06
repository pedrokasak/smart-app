import { addDays, daysBetween, toBrDate, toBrMonth } from './dates';

describe('dates', () => {
	it('soma dias corridos sem depender de fuso nem de horário de verão', () => {
		expect(addDays('2026-10-05', 1)).toBe('2026-10-06');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // ano bissexto
		expect(addDays('2026-10-05', -5)).toBe('2026-09-30');
		// 3 anos incluem o 29/02/2028: 1095 dias terminam um dia antes do aniversário.
		expect(addDays('2026-10-05', 1095)).toBe('2029-10-04');
	});

	it('conta dias entre duas datas, com sinal', () => {
		expect(daysBetween('2026-10-01', '2026-10-05')).toBe(4);
		expect(daysBetween('2026-10-05', '2026-10-01')).toBe(-4);
		expect(daysBetween('2026-10-05', '2026-10-05')).toBe(0);
		expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
	});

	it('formata data e mês para o texto exibido', () => {
		expect(toBrDate('2026-10-02')).toBe('02/10/2026');
		expect(toBrMonth('2026-08-01')).toBe('08/2026');
	});
});
