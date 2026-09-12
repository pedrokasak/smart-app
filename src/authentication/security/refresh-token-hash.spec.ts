import * as crypto from 'crypto';
import {
	hashRefreshToken,
	isRefreshTokenDigest,
	matchesRefreshTokenDigest,
} from './refresh-token-hash';

describe('refresh-token-hash', () => {
	const token = 'header.payload.signature';

	describe('hashRefreshToken', () => {
		it('produces the SHA-256 hex digest of the token', () => {
			expect(hashRefreshToken(token)).toBe(
				crypto.createHash('sha256').update(token, 'utf8').digest('hex')
			);
		});

		it('is deterministic and 64 hex chars long', () => {
			const digest = hashRefreshToken(token);

			expect(digest).toHaveLength(64);
			expect(digest).toMatch(/^[0-9a-f]{64}$/);
			expect(hashRefreshToken(token)).toBe(digest);
		});

		it('produces different digests for different tokens', () => {
			expect(hashRefreshToken('a')).not.toBe(hashRefreshToken('b'));
		});
	});

	describe('isRefreshTokenDigest', () => {
		it('accepts a SHA-256 hex digest', () => {
			expect(isRefreshTokenDigest(hashRefreshToken(token))).toBe(true);
		});

		it('rejects legacy Argon2 and bcrypt hashes', () => {
			expect(
				isRefreshTokenDigest(
					'$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$aGFzaGVkdmFsdWVoZXJlMTIz'
				)
			).toBe(false);
			expect(
				isRefreshTokenDigest(
					'$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012'
				)
			).toBe(false);
		});

		it('rejects wrong lengths, non-hex and uppercase hex', () => {
			expect(isRefreshTokenDigest('')).toBe(false);
			expect(isRefreshTokenDigest('abc123')).toBe(false);
			expect(isRefreshTokenDigest('z'.repeat(64))).toBe(false);
			expect(isRefreshTokenDigest(hashRefreshToken(token) + 'a')).toBe(false);
			expect(isRefreshTokenDigest(hashRefreshToken(token).toUpperCase())).toBe(
				false
			);
		});

		it('rejects non-string values without throwing', () => {
			expect(isRefreshTokenDigest(null as unknown as string)).toBe(false);
			expect(isRefreshTokenDigest(undefined as unknown as string)).toBe(false);
		});
	});

	describe('matchesRefreshTokenDigest', () => {
		it('matches the digest of the same token', () => {
			expect(matchesRefreshTokenDigest(token, hashRefreshToken(token))).toBe(
				true
			);
		});

		it('does not match the digest of a different token', () => {
			expect(
				matchesRefreshTokenDigest('other.token.here', hashRefreshToken(token))
			).toBe(false);
		});

		it('does not throw on a length mismatch and returns false', () => {
			// timingSafeEqual lança com buffers de tamanhos diferentes; o guarda de
			// comprimento tem que absorver isso em vez de estourar como 500.
			const shorter = hashRefreshToken(token).slice(0, 32);
			const longer = hashRefreshToken(token) + 'ff';

			expect(() => matchesRefreshTokenDigest(token, shorter)).not.toThrow();
			expect(matchesRefreshTokenDigest(token, shorter)).toBe(false);
			expect(() => matchesRefreshTokenDigest(token, longer)).not.toThrow();
			expect(matchesRefreshTokenDigest(token, longer)).toBe(false);
		});

		it('does not throw on empty, null or legacy stored values', () => {
			expect(() => matchesRefreshTokenDigest(token, '')).not.toThrow();
			expect(matchesRefreshTokenDigest(token, '')).toBe(false);
			expect(matchesRefreshTokenDigest(token, null as unknown as string)).toBe(
				false
			);
			expect(matchesRefreshTokenDigest(token, '$argon2id$v=19$whatever')).toBe(
				false
			);
		});

		it('rejects an equal-length digest that differs only in the last byte', () => {
			// Caso que só o caminho de comparação byte a byte cobre: mesmo
			// comprimento, prefixo idêntico, último byte diferente.
			const digest = hashRefreshToken(token);
			const lastByte = digest.slice(62);
			const flipped = digest.slice(0, 62) + (lastByte === '00' ? 'ff' : '00');

			expect(flipped).toHaveLength(64);
			expect(flipped).not.toBe(digest);
			expect(matchesRefreshTokenDigest(token, flipped)).toBe(false);
		});
	});
});
