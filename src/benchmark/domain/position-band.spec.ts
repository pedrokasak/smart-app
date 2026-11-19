import { positionIn } from 'src/benchmark/domain/position-band';
import { wealthBandOf } from 'src/benchmark/domain/cohort';

const stats = { p25: 40, p50: 55, p75: 70 };

describe('positionIn (ADR-003): bands, never a ranking', () => {
	it.each([
		[80, 'top_quarter'],
		[70, 'top_quarter'],
		[60, 'above_median'],
		[55, 'above_median'],
		[50, 'below_median'],
		[41, 'below_median'],
		[40, 'bottom_quarter'],
		[10, 'bottom_quarter'],
	])('%d is %s', (value, band) => {
		expect(positionIn(value, stats)).toBe(band);
	});
});

describe('wealthBandOf (ADR-003)', () => {
	it.each([
		[0, 'upto_50k'],
		[50_000, 'upto_50k'],
		[50_000.01, '50k_250k'],
		[250_000, '50k_250k'],
		[250_000.01, 'above_250k'],
	])('R$ %d is in %s', (netWorth, band) => {
		expect(wealthBandOf(netWorth)).toBe(band);
	});
});
