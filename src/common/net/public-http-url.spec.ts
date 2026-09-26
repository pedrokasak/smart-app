import {
	assertPublicHttpUrl,
	isPublicIp,
	UnsafeUrlError,
} from './public-http-url';

describe('isPublicIp', () => {
	it.each([
		'127.0.0.1',
		'10.1.2.3',
		'172.16.0.1',
		'172.31.255.255',
		'192.168.1.1',
		'169.254.169.254',
		'100.64.0.1',
		'0.0.0.0',
		'224.0.0.1',
		'::1',
		'::',
		'fc00::1',
		'fd12:3456::1',
		'fe80::1',
		'ff02::1',
		'::ffff:127.0.0.1',
		'::ffff:c0a8:a',
		'64:ff9b::a00:1',
	])('%s não é público', (ip) => {
		expect(isPublicIp(ip)).toBe(false);
	});

	it.each(['8.8.8.8', '172.32.0.1', '200.147.67.142', '2606:4700::1111'])(
		'%s é público',
		(ip) => {
			expect(isPublicIp(ip)).toBe(true);
		}
	);

	it('texto que não é IP não é público', () => {
		expect(isPublicIp('localhost')).toBe(false);
	});
});

describe('assertPublicHttpUrl', () => {
	it.each([
		['file:///etc/passwd', 'scheme_not_allowed'],
		['gopher://1.1.1.1/', 'scheme_not_allowed'],
		['http://user:pass@8.8.8.8/', 'credentials_in_url'],
		['http://127.0.0.1:27017/', 'private_address'],
		['http://[::1]/', 'private_address'],
		['não é url', 'invalid_url'],
	])('recusa %s (%s)', async (url, reason) => {
		await expect(assertPublicHttpUrl(url)).rejects.toMatchObject({
			reason,
		});
		await expect(assertPublicHttpUrl(url)).rejects.toBeInstanceOf(
			UnsafeUrlError
		);
	});

	it('aceita IP público literal', async () => {
		await expect(
			assertPublicHttpUrl('https://8.8.8.8/doc.pdf')
		).resolves.toBeInstanceOf(URL);
	});
});
