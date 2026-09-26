import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {
	constructor(readonly reason: string) {
		super(`URL recusada: ${reason}`);
	}
}

const BLOCKED_IPV4: Array<[number, number]> = [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4],
].map(([base, bits]) => [ipv4ToInt(base as string), bits as number]);

function ipv4ToInt(ip: string): number {
	return (
		ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
	);
}

function isBlockedIpv4(ip: string): boolean {
	const value = ipv4ToInt(ip);
	return BLOCKED_IPV4.some(([base, bits]) => {
		const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
		return (value & mask) === (base & mask);
	});
}

function isBlockedIpv6(ip: string): boolean {
	const lower = ip.toLowerCase();
	const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return isBlockedIpv4(mapped[1]);
	// `new URL()` normaliza ::ffff:192.168.0.10 para ::ffff:c0a8:a.
	const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
	if (mappedHex) {
		const high = parseInt(mappedHex[1], 16);
		const low = parseInt(mappedHex[2], 16);
		return isBlockedIpv4(
			`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
		);
	}
	if (lower === '::' || lower === '::1') return true;
	const firstHextet = parseInt(lower.split(':')[0] || '0', 16);
	if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
	if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
	if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 (multicast)
	if (lower.startsWith('64:ff9b:')) return true; // NAT64 aponta para IPv4 arbitrário
	return false;
}

export function isPublicIp(ip: string): boolean {
	const family = isIP(ip);
	if (family === 4) return !isBlockedIpv4(ip);
	if (family === 6) return !isBlockedIpv6(ip);
	return false;
}

/**
 * Barreira contra SSRF para URL vinda de fora: só http(s) e só host que
 * resolve inteiramente para IP público. Não cobre DNS rebinding entre esta
 * checagem e o fetch; por isso redirects precisam ser revalidados a cada salto.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new UnsafeUrlError('invalid_url');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new UnsafeUrlError('scheme_not_allowed');
	}
	if (url.username || url.password) {
		throw new UnsafeUrlError('credentials_in_url');
	}
	const host = url.hostname.replace(/^\[|\]$/g, '');
	const addresses = isIP(host)
		? [host]
		: await lookup(host, { all: true, verbatim: true })
				.then((entries) => entries.map((entry) => entry.address))
				.catch(() => {
					throw new UnsafeUrlError('dns_failed');
				});
	if (!addresses.length || !addresses.every(isPublicIp)) {
		throw new UnsafeUrlError('private_address');
	}
	return url;
}
