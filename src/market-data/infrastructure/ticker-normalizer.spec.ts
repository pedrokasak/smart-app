import { normalizeTickerForProvider } from './ticker-normalizer';

describe('normalizeTickerForProvider', () => {
	it('appends .SA for B3 stock tickers when targeting yahoo', () => {
		expect(normalizeTickerForProvider('PETR4', 'yahoo', 'stock')).toBe(
			'PETR4.SA'
		);
	});

	it('appends .SA for B3 fii tickers when targeting yahoo', () => {
		expect(normalizeTickerForProvider('MXRF11', 'yahoo', 'fii')).toBe(
			'MXRF11.SA'
		);
	});

	// Cripto vira par contra o REAL: a carteira é em reais, e BTC-USD
	// misturaria a variação do câmbio na correlação e no risco (TRA-141).
	it('turns crypto tickers into a BRL pair', () => {
		expect(normalizeTickerForProvider('BTC', 'yahoo', 'crypto')).toBe(
			'BTC-BRL'
		);
		expect(normalizeTickerForProvider(' eth ', 'yahoo', 'crypto')).toBe(
			'ETH-BRL'
		);
	});

	it('keeps a crypto pair the caller already chose', () => {
		expect(normalizeTickerForProvider('BTC-USD', 'yahoo', 'crypto')).toBe(
			'BTC-USD'
		);
	});

	it('does not append a suffix for global/US stock tickers', () => {
		expect(normalizeTickerForProvider('AAPL', 'yahoo', 'stock')).toBe('AAPL');
	});

	it('does not double-append .SA if already present', () => {
		expect(normalizeTickerForProvider('PETR4.SA', 'yahoo', 'stock')).toBe(
			'PETR4.SA'
		);
	});

	it('uppercases and trims the input ticker', () => {
		expect(normalizeTickerForProvider(' petr4 ', 'yahoo', 'stock')).toBe(
			'PETR4.SA'
		);
	});
});
