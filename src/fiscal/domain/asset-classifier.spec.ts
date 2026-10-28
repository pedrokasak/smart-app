import {
	KNOWN_ETF_TICKERS,
	KNOWN_UNIT_TICKERS,
	classifyFiscalCategory,
} from 'src/fiscal/domain/asset-classifier';

describe('classifyFiscalCategory (TRA-287)', () => {
	// O caso do print: o simulador mostrou 20% para BOVA11.
	describe.each(['BOVA11', 'IVVB11'])('%s (ETF)', (ticker) => {
		// A importação da B3 grava `fii` para qualquer ticker com 11.
		it.each([['fii'], ['stock'], ['etf'], [undefined], ['']])(
			'é ETF com o tipo gravado %p',
			(type) => {
				expect(classifyFiscalCategory(ticker, type)).toBe('etf');
			}
		);
	});

	describe('SANB11 (unit)', () => {
		it.each([['fii'], ['stock'], [undefined]])(
			'é tratado como ação com o tipo gravado %p',
			(type) => {
				expect(classifyFiscalCategory('SANB11', type)).toBe('stock');
			}
		);

		it('vale também para outras units conhecidas', () => {
			expect(classifyFiscalCategory('TAEE11', 'fii')).toBe('stock');
			expect(classifyFiscalCategory('KLBN11', 'fii')).toBe('stock');
		});
	});

	describe('FII', () => {
		it('mantém um FII conhecido como FII', () => {
			expect(classifyFiscalCategory('HGLG11', 'fii')).toBe('fii');
			expect(classifyFiscalCategory('XPLG11', 'fii')).toBe('fii');
		});

		// Comportamento de antes, preservado: o lado seguro é não dar isenção.
		it('ticker com 11 fora dos catálogos segue como FII sem tipo ou como stock', () => {
			expect(classifyFiscalCategory('NOVO11')).toBe('fii');
			expect(classifyFiscalCategory('NOVO11', 'stock')).toBe('fii');
			expect(classifyFiscalCategory('NOVO11', 'fund')).toBe('fii');
		});
	});

	describe('tipo explícito', () => {
		it('respeita `etf` num ticker sem sufixo 11 (antes virava ação isenta)', () => {
			expect(classifyFiscalCategory('NOVETF', 'etf')).toBe('etf');
		});

		it('respeita `etf` num ticker com 11 fora dos catálogos (antes virava FII)', () => {
			expect(classifyFiscalCategory('NOVO11', 'etf')).toBe('etf');
		});

		it('cripto explícita vence qualquer catálogo', () => {
			expect(classifyFiscalCategory('BTC', 'crypto')).toBe('crypto');
			expect(classifyFiscalCategory('HASH11', 'crypto')).toBe('crypto');
		});
	});

	describe('ações', () => {
		it('classifica ações comuns e preferenciais como stock', () => {
			expect(classifyFiscalCategory('PETR4', 'stock')).toBe('stock');
			expect(classifyFiscalCategory('VALE3')).toBe('stock');
		});

		it('tipos que não mudam a classe continuam como antes', () => {
			expect(classifyFiscalCategory('XYZW3', 'fund')).toBe('stock');
			expect(classifyFiscalCategory('XYZW3', 'other')).toBe('stock');
		});
	});

	describe('normalização do ticker', () => {
		it('ignora caixa, espaços e o sufixo .SA', () => {
			expect(classifyFiscalCategory(' bova11 ', 'fii')).toBe('etf');
			expect(classifyFiscalCategory('BOVA11.SA', 'fii')).toBe('etf');
			expect(classifyFiscalCategory('sanb11.sa', 'fii')).toBe('stock');
		});

		it('não quebra com símbolo vazio', () => {
			expect(classifyFiscalCategory('')).toBe('stock');
			expect(classifyFiscalCategory(undefined as unknown as string)).toBe(
				'stock'
			);
		});
	});

	describe('catálogos', () => {
		const shape = /^[A-Z]{4}11$/;

		it('só têm tickers no formato de fundo ou unit (4 letras + 11)', () => {
			for (const ticker of [...KNOWN_ETF_TICKERS, ...KNOWN_UNIT_TICKERS]) {
				expect(ticker).toMatch(shape);
			}
		});

		it('não repetem ticker entre ETF e unit', () => {
			for (const ticker of KNOWN_ETF_TICKERS) {
				expect(KNOWN_UNIT_TICKERS.has(ticker)).toBe(false);
			}
		});

		it('incluem os três casos que motivaram a correção', () => {
			expect(KNOWN_ETF_TICKERS.has('BOVA11')).toBe(true);
			expect(KNOWN_ETF_TICKERS.has('IVVB11')).toBe(true);
			expect(KNOWN_UNIT_TICKERS.has('SANB11')).toBe(true);
		});
	});
});
