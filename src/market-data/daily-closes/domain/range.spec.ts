import { coversRange, rangeStart } from './range';
import {
	brasiliaDate,
	daysAgo,
	isWeekday,
	lastWeekdays,
	yearOf,
} from './trading-days';

// Quarta-feira, 7 de outubro de 2026, meio-dia em Brasília.
const NOW = new Date('2026-10-07T15:00:00.000Z');

describe('trading-days (TRA-251)', () => {
	it('usa o calendário de Brasília, não o UTC', () => {
		// 01:30 UTC de quinta ainda é quarta à noite em Brasília.
		expect(brasiliaDate(new Date('2026-10-08T01:30:00.000Z'))).toBe(
			'2026-10-07'
		);
	});

	it('reconhece dias úteis', () => {
		expect(isWeekday('2026-10-07')).toBe(true);
		expect(isWeekday('2026-10-10')).toBe(false);
		expect(isWeekday('2026-10-11')).toBe(false);
	});

	it('lastWeekdays pula fim de semana e vai do mais antigo ao mais novo', () => {
		expect(lastWeekdays(new Date('2026-10-12T15:00:00.000Z'), 3)).toEqual([
			'2026-10-08',
			'2026-10-09',
			'2026-10-12',
		]);
	});

	it('hoje de fim de semana não entra', () => {
		expect(lastWeekdays(new Date('2026-10-10T15:00:00.000Z'), 2)).toEqual([
			'2026-10-08',
			'2026-10-09',
		]);
	});

	it('daysAgo e yearOf', () => {
		expect(daysAgo(NOW, 7)).toBe('2026-09-30');
		expect(yearOf('2026-10-07')).toBe(2026);
	});
});

describe('range (TRA-251)', () => {
	it('traduz o vocabulário do Yahoo em data inicial', () => {
		expect(rangeStart('1y', NOW)).toBe('2025-10-06');
		expect(rangeStart('3mo', NOW)).toBe('2026-07-06');
		expect(rangeStart('ytd', NOW)).toBe('2026-01-01');
		expect(rangeStart('max', NOW)).toBe('1900-01-01');
		expect(rangeStart('desconhecido', NOW)).toBe('1900-01-01');
	});

	const close = (date: string) => ({ date, close: 10 });

	it('série que começa perto do início e está fresca cobre o período', () => {
		expect(
			coversRange([close('2025-10-08'), close('2026-10-06')], '1y', NOW)
		).toBe(true);
	});

	it('série que começa tarde demais não cobre', () => {
		expect(
			coversRange([close('2026-03-01'), close('2026-10-06')], '1y', NOW)
		).toBe(false);
	});

	it('série parada não cobre', () => {
		expect(
			coversRange([close('2025-10-08'), close('2026-09-01')], '1y', NOW)
		).toBe(false);
	});

	it('série vazia e "max" nunca são provadas completas', () => {
		expect(coversRange([], '1y', NOW)).toBe(false);
		expect(
			coversRange([close('1990-01-02'), close('2026-10-06')], 'max', NOW)
		).toBe(false);
	});
});
