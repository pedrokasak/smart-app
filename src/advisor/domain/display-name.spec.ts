import { normalizeDisplayName } from './display-name';

describe('normalizeDisplayName', () => {
	const limits = { min: 2, max: 5 };

	it('trims and returns a valid name', () => {
		expect(normalizeDisplayName('  Ana ', limits)).toBe('Ana');
	});

	it.each([
		['too short', 'a'],
		['too long', 'abcdef'],
		['blank', '   '],
		['control char', 'ab\u0007c'],
		['right-to-left override', 'ab\u202Ec'],
		['zero-width space', 'ab\u200Bc'],
	])('rejects %s', (_l, value) => {
		expect(normalizeDisplayName(value, limits)).toBeNull();
	});

	it('rejects a non-string', () => {
		expect(normalizeDisplayName(undefined, limits)).toBeNull();
		expect(normalizeDisplayName(12, limits)).toBeNull();
	});

	it('measures the length after trim', () => {
		expect(normalizeDisplayName('  abcde  ', limits)).toBe('abcde');
	});
});
