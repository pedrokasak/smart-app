import { meetsMinimumVersion } from './app-version.policy';

describe('meetsMinimumVersion', () => {
	it.each([
		['1.2.3', '1.2.3', true],
		['1.2.4', '1.2.3', true],
		['1.10.0', '1.9.0', true],
		['2.0.0', '1.99.99', true],
		['1.2.2', '1.2.3', false],
		['1.9.0', '1.10.0', false],
		['0.9.9', '1.0.0', false],
		[' 1.2.3 ', '1.2.3', true],
	])('%s contra o mínimo %s: %s', (version, minimum, expected) => {
		expect(meetsMinimumVersion(version, minimum)).toBe(expected);
	});

	it.each([[undefined], [''], ['1.2'], ['1.2.3-beta'], ['abc'], ['1.2.3.4']])(
		'versão inválida %s não atende',
		(version) => {
			expect(meetsMinimumVersion(version, '0.0.0')).toBe(false);
		}
	);
});
