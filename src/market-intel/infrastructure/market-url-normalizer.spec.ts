import {
	computeSimHash,
	hammingDistance,
	MarketUrlNormalizerImpl,
} from './market-url-normalizer';

describe('MarketUrlNormalizerImpl', () => {
	let normalizer: MarketUrlNormalizerImpl;

	beforeEach(() => {
		normalizer = new MarketUrlNormalizerImpl();
	});

	describe('canonicalize', () => {
		it('removes utm params', () => {
			const url =
				'https://infomoney.com.br/artigo?utm_source=twitter&utm_medium=social&id=123';
			const result = normalizer.canonicalize(url);
			expect(result).toBe('https://infomoney.com.br/artigo?id=123');
		});

		it('removes trailing slash', () => {
			const result = normalizer.canonicalize('https://site.com/artigo/');
			expect(result).toBe('https://site.com/artigo');
		});

		it('keeps root slash', () => {
			const result = normalizer.canonicalize('https://site.com/');
			expect(result).toContain('site.com');
		});

		it('sorts remaining params', () => {
			const a = normalizer.canonicalize('https://site.com/p?z=1&a=2');
			const b = normalizer.canonicalize('https://site.com/p?a=2&z=1');
			expect(a).toBe(b);
		});

		it('lowercases host', () => {
			const result = normalizer.canonicalize('HTTPS://InfoMoney.COM.BR/artigo');
			expect(result).toContain('infomoney.com.br');
		});

		it('preserves path case (URLs are case-sensitive)', () => {
			const result = normalizer.canonicalize('https://site.com/Artigo-Importante');
			expect(result).toBe('https://site.com/Artigo-Importante');
		});
	});

	describe('urlHash', () => {
		it('returns 64-char hex', () => {
			const hash = normalizer.urlHash('https://example.com/artigo');
			expect(hash).toHaveLength(64);
			expect(hash).toMatch(/^[0-9a-f]+$/);
		});

		it('same URL same hash', () => {
			const url = 'https://example.com/artigo';
			expect(normalizer.urlHash(url)).toBe(normalizer.urlHash(url));
		});
	});

	describe('contentHash', () => {
		it('same content same hash', () => {
			expect(normalizer.contentHash('Title', 'Desc')).toBe(
				normalizer.contentHash('Title', 'Desc')
			);
		});

		it('different content different hash', () => {
			expect(normalizer.contentHash('Title A', 'Desc')).not.toBe(
				normalizer.contentHash('Title B', 'Desc')
			);
		});
	});

	describe('tokenize', () => {
		it('removes stop words', () => {
			const tokens = normalizer.tokenize('A taxa de juros subiu hoje');
			expect(tokens).not.toContain('a');
			expect(tokens).not.toContain('de');
			expect(tokens).toContain('taxa');
			expect(tokens).toContain('juros');
		});

		it('filters short tokens', () => {
			const tokens = normalizer.tokenize('ab cde fgh');
			expect(tokens).not.toContain('ab');
			expect(tokens).toContain('cde');
		});
	});
});

describe('computeSimHash', () => {
	it('returns deterministic bigint', () => {
		const tokens = ['banco', 'central', 'taxa', 'juros'];
		expect(computeSimHash(tokens)).toBe(computeSimHash(tokens));
	});

	it('similar texts have small hamming distance', () => {
		const tokens1 = ['banco', 'central', 'eleva', 'taxa', 'juros', 'selic'];
		const tokens2 = ['banco', 'central', 'aumenta', 'taxa', 'juros', 'selic'];
		const d = hammingDistance(computeSimHash(tokens1), computeSimHash(tokens2));
		// Textos com 4/6 tokens em comum — distância ≤ 32 é "próximo" neste SimHash
		expect(d).toBeLessThan(32);
	});

	it('very different texts have large distance', () => {
		const tokens1 = ['banana', 'maçã', 'fruta', 'mercado', 'feira'];
		const tokens2 = ['taxa', 'selic', 'juros', 'banco', 'central'];
		const d = hammingDistance(computeSimHash(tokens1), computeSimHash(tokens2));
		expect(d).toBeGreaterThan(5);
	});

	it('empty tokens', () => {
		expect(computeSimHash([])).toBe(BigInt(0));
	});
});

describe('hammingDistance', () => {
	it('identical = 0', () => {
		expect(hammingDistance(BigInt(0x1234), BigInt(0x1234))).toBe(0);
	});

	it('one bit diff = 1', () => {
		expect(hammingDistance(BigInt(0), BigInt(1))).toBe(1);
	});
});
