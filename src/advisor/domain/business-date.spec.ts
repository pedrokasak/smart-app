import { addIsoDays, BUSINESS_TIME_ZONE, businessDate } from './business-date';

describe('businessDate (America/Sao_Paulo)', () => {
	it('uses the São Paulo time zone', () => {
		expect(BUSINESS_TIME_ZONE).toBe('America/Sao_Paulo');
	});

	it('23:30 BRT (02:30 UTC of the next day) is still the BRT date', () => {
		expect(businessDate(new Date('2026-11-24T02:30:00.000Z'))).toBe(
			'2026-11-23'
		);
	});

	it('00:30 BRT is the new BRT date', () => {
		expect(businessDate(new Date('2026-11-24T03:30:00.000Z'))).toBe(
			'2026-11-24'
		);
	});

	it('pads month and day', () => {
		expect(businessDate(new Date('2026-01-05T12:00:00.000Z'))).toBe(
			'2026-01-05'
		);
	});
});

describe('addIsoDays', () => {
	it('moves a calendar date, across months and years', () => {
		expect(addIsoDays('2026-11-23', 1)).toBe('2026-11-24');
		expect(addIsoDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addIsoDays('2026-03-01', -1)).toBe('2026-02-28');
	});
});
