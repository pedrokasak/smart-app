import { MAX_QUOTE_DRIFT, isPlausibleQuote } from './quote-plausibility';

describe('isPlausibleQuote', () => {
	it('accepts years of quota growth', () => {
		expect(isPlausibleQuote(1.0, 8.4)).toBe(true);
		expect(isPlausibleQuote(44.63, 44.65)).toBe(true);
	});

	it('accepts a quota that lost value', () => {
		expect(isPlausibleQuote(100, 40)).toBe(true);
	});

	it('rejects the amount invested typed as the quota price', () => {
		// 1 "cota" de R$ 10.000 num fundo com cota de R$ 2,50.
		expect(isPlausibleQuote(10_000, 2.5)).toBe(false);
	});

	it('uses the drift limit on both sides', () => {
		expect(isPlausibleQuote(1, MAX_QUOTE_DRIFT)).toBe(true);
		expect(isPlausibleQuote(1, MAX_QUOTE_DRIFT + 0.01)).toBe(false);
		expect(isPlausibleQuote(MAX_QUOTE_DRIFT, 1)).toBe(true);
		expect(isPlausibleQuote(MAX_QUOTE_DRIFT + 0.01, 1)).toBe(false);
	});

	it('rejects zero, negative and missing values', () => {
		expect(isPlausibleQuote(10, 0)).toBe(false);
		expect(isPlausibleQuote(10, -0.97)).toBe(false);
		expect(isPlausibleQuote(0, 10)).toBe(false);
		expect(isPlausibleQuote(Number.NaN, 10)).toBe(false);
	});
});
