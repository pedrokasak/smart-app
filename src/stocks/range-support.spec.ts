import {
	DEFAULT_BRAPI_RANGES,
	parseSupportedRanges,
	isRangeSupportedByBrapi,
} from './range-support';

describe('parseSupportedRanges', () => {
	it('falls back to the current plan ranges when unset', () => {
		expect(parseSupportedRanges(undefined)).toEqual([...DEFAULT_BRAPI_RANGES]);
		expect(parseSupportedRanges('')).toEqual([...DEFAULT_BRAPI_RANGES]);
		expect(parseSupportedRanges('   ')).toEqual([...DEFAULT_BRAPI_RANGES]);
	});

	it('parses a comma separated list, trimming and lowercasing', () => {
		expect(parseSupportedRanges(' 1D , 5d ,1mo ')).toEqual(['1d', '5d', '1mo']);
	});

	it('drops empty entries from a sloppy list', () => {
		expect(parseSupportedRanges('1d,,5d,')).toEqual(['1d', '5d']);
	});
});

describe('isRangeSupportedByBrapi', () => {
	afterEach(() => {
		delete process.env.BRAPI_SUPPORTED_RANGES;
	});

	it('accepts the current plan ranges by default', () => {
		expect(isRangeSupportedByBrapi('1mo')).toBe(true);
		expect(isRangeSupportedByBrapi('3mo')).toBe(true);
	});

	it('rejects ranges the current plan does not serve', () => {
		expect(isRangeSupportedByBrapi('1y')).toBe(false);
		expect(isRangeSupportedByBrapi('5y')).toBe(false);
		expect(isRangeSupportedByBrapi('6mo')).toBe(false);
		expect(isRangeSupportedByBrapi('7d')).toBe(false);
	});

	it('treats an absent range as supported, since brapi picks its own default', () => {
		expect(isRangeSupportedByBrapi(undefined)).toBe(true);
	});

	it('follows the env var when the plan is upgraded', () => {
		process.env.BRAPI_SUPPORTED_RANGES = '1d,5d,1mo,3mo,6mo,1y,5y';
		expect(isRangeSupportedByBrapi('1y')).toBe(true);
		expect(isRangeSupportedByBrapi('5y')).toBe(true);
	});

	it('is case insensitive', () => {
		expect(isRangeSupportedByBrapi('1MO')).toBe(true);
	});
});
