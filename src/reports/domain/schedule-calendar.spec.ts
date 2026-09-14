import { nextRunAt, reportYearFor } from './schedule-calendar';
import { computeReceivedDividends } from './received-dividends';

describe('schedule-calendar', () => {
	// 2026-09-14 é segunda-feira.
	const monday8am = new Date('2026-09-14T11:00:00Z');

	it('runs weekly on the next Monday at 08:00 BRT', () => {
		expect(
			nextRunAt('weekly', new Date('2026-09-10T15:00:00Z')).toISOString()
		).toBe('2026-09-14T11:00:00.000Z');
		// Exatamente no horário: a próxima é a da semana seguinte.
		expect(nextRunAt('weekly', monday8am).toISOString()).toBe(
			'2026-09-21T11:00:00.000Z'
		);
		expect(
			nextRunAt('weekly', new Date('2026-09-14T09:00:00Z')).toISOString()
		).toBe('2026-09-14T11:00:00.000Z');
	});

	it('runs monthly on day 1, rolling the year in December', () => {
		expect(nextRunAt('monthly', monday8am).toISOString()).toBe(
			'2026-10-01T11:00:00.000Z'
		);
		expect(
			nextRunAt('monthly', new Date('2026-12-20T00:00:00Z')).toISOString()
		).toBe('2027-01-01T11:00:00.000Z');
	});

	it('runs quarterly on the first day of the next quarter', () => {
		expect(nextRunAt('quarterly', monday8am).toISOString()).toBe(
			'2026-10-01T11:00:00.000Z'
		);
		expect(
			nextRunAt('quarterly', new Date('2026-10-01T10:00:00Z')).toISOString()
		).toBe('2026-10-01T11:00:00.000Z');
	});

	it('runs yearly on January 5 and reports the closed year', () => {
		const run = nextRunAt('yearly', monday8am);
		expect(run.toISOString()).toBe('2027-01-05T11:00:00.000Z');
		expect(reportYearFor('yearly', run)).toBe(2026);
		expect(reportYearFor('monthly', new Date('2027-01-01T11:00:00Z'))).toBe(
			2026
		);
		expect(reportYearFor('monthly', monday8am)).toBe(2026);
	});
});

describe('computeReceivedDividends', () => {
	it('multiplies per-share value by the quantity held on the event date', () => {
		const rows = computeReceivedDividends(
			[
				{
					symbol: 'itsa4',
					quantity: 300,
					dividendHistory: [
						{
							date: '2026-03-10T00:00:00Z',
							value: 0.5,
							paymentType: 'DIVIDEND',
						},
						{ date: '2026-06-10T00:00:00Z', value: 0.25, paymentType: 'JCP' },
						{ date: '2025-12-10T00:00:00Z', value: 9 },
					],
				},
			],
			[
				{
					symbol: 'ITSA4',
					side: 'buy',
					quantity: 100,
					date: '2026-01-05T00:00:00Z',
				},
				{
					symbol: 'ITSA4',
					side: 'buy',
					quantity: 200,
					date: '2026-05-05T00:00:00Z',
				},
			],
			2026
		);

		expect(rows).toEqual([
			{
				symbol: 'ITSA4',
				month: 3,
				paymentType: 'DIVIDEND',
				perShare: 0.5,
				quantity: 100,
				amount: 50,
				estimated: false,
			},
			{
				symbol: 'ITSA4',
				month: 6,
				paymentType: 'JCP',
				perShare: 0.25,
				quantity: 300,
				amount: 75,
				estimated: false,
			},
		]);
	});

	it('falls back to the current quantity when there are no trades, flagged as estimated', () => {
		const [row] = computeReceivedDividends(
			[
				{
					symbol: 'HGLG11',
					quantity: 10,
					dividendHistory: [{ date: '2026-02-01', value: 1.1 }],
				},
			],
			[],
			2026
		);
		expect(row).toMatchObject({ quantity: 10, amount: 11, estimated: true });
	});
});
