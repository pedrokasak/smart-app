import { StocksRiIssuerCatalogAdapter } from 'src/ri-intelligence/infrastructure/stocks-ri-issuer-catalog.adapter';
import { StockService } from 'src/stocks/stocks.service';

describe('StocksRiIssuerCatalogAdapter', () => {
	function makeStockService(quote: any) {
		return {
			getNationalQuote: jest.fn(async () => quote),
		} as unknown as StockService;
	}

	function makeB3Registry() {
		return { resolveCnpj: jest.fn().mockResolvedValue(null) } as any;
	}

	it('resolves ticker to normalized CNPJ ref via Brapi national quote', async () => {
		const stockService = makeStockService({
			results: [
				{
					symbol: 'PETR4',
					longName: 'Petróleo Brasileiro S.A. - Petrobras',
					cnpj: '33.000.167/0001-01',
				},
			],
		});
		const adapter = new StocksRiIssuerCatalogAdapter(stockService, makeB3Registry());

		const ref = await adapter.resolveByTicker('petr4');

		expect(ref).toEqual({
			ticker: 'PETR4',
			company: 'Petróleo Brasileiro S.A. - Petrobras',
			cnpj: '33000167000101',
		});
		expect(stockService.getNationalQuote).toHaveBeenCalledWith('PETR4', {
			fundamental: true,
		});
	});

	it('normalizes a .SA suffix and trims the ticker before lookup', async () => {
		const stockService = makeStockService({
			results: [
				{
					symbol: 'VALE3',
					shortName: 'VALE',
					cnpj: '33.602.724/0001-34',
				},
			],
		});
		const adapter = new StocksRiIssuerCatalogAdapter(stockService, makeB3Registry());

		const ref = await adapter.resolveByTicker('vale3.SA');

		expect(ref?.ticker).toBe('VALE3');
		expect(ref?.cnpj).toBe('33602724000134');
		expect(stockService.getNationalQuote).toHaveBeenCalledWith('VALE3', {
			fundamental: true,
		});
	});

	it('returns null and skips CVM when the quote has no CNPJ and the B3 registry has no match either', async () => {
		const stockService = makeStockService({
			results: [{ symbol: 'XXXX3', longName: 'Sem CNPJ SA' }],
		});
		const adapter = new StocksRiIssuerCatalogAdapter(stockService, makeB3Registry());

		const ref = await adapter.resolveByTicker('XXXX3');

		expect(ref).toBeNull();
	});

	it('returns null when Brapi lookup fails', async () => {
		const stockService = {
			getNationalQuote: jest.fn().mockRejectedValue(new Error('brapi down')),
		} as unknown as StockService;
		const adapter = new StocksRiIssuerCatalogAdapter(stockService, makeB3Registry());

		const ref = await adapter.resolveByTicker('ITUB4');

		expect(ref).toBeNull();
	});

	it('dedups concurrent resolutions for the same ticker (in-flight cache)', async () => {
		const stockService = makeStockService({
			results: [{ symbol: 'ITUB4', cnpj: '60.872.504/0001-23' }],
		});
		const adapter = new StocksRiIssuerCatalogAdapter(stockService, makeB3Registry());

		const [a, b] = await Promise.all([
			adapter.resolveByTicker('ITUB4'),
			adapter.resolveByTicker('ITUB4'),
		]);

		expect(a?.cnpj).toBe('60872504000123');
		expect(b?.cnpj).toBe('60872504000123');
		// Apenas uma chamada Brapi para as duas invocações concorrentes.
		expect(stockService.getNationalQuote).toHaveBeenCalledTimes(1);
	});
});

describe('StocksRiIssuerCatalogAdapter — B3 registry fallback', () => {
	it('falls back to the B3 registry when Brapi has no cnpj', async () => {
		const stockService = {
			getNationalQuote: jest.fn().mockResolvedValue({
				results: [{ symbol: 'ABCD3', cnpj: null, longName: null }],
			}),
		};
		const b3Registry = {
			resolveCnpj: jest.fn().mockResolvedValue({
				cnpj: '12345678000190',
				company: 'Empresa Real S.A.',
			}),
		};
		const adapter = new (require('./stocks-ri-issuer-catalog.adapter').StocksRiIssuerCatalogAdapter)(
			stockService,
			b3Registry
		);

		const result = await adapter.resolveByTicker('ABCD3');

		expect(b3Registry.resolveCnpj).toHaveBeenCalledWith('ABCD3');
		expect(result).toEqual({
			ticker: 'ABCD3',
			company: 'Empresa Real S.A.',
			cnpj: '12345678000190',
		});
	});

	it('does not call the B3 registry when Brapi already has a cnpj', async () => {
		const stockService = {
			getNationalQuote: jest.fn().mockResolvedValue({
				results: [{ symbol: 'PETR4', cnpj: '33.000.167/0001-01', longName: 'Petrobras' }],
			}),
		};
		const b3Registry = { resolveCnpj: jest.fn() };
		const adapter = new (require('./stocks-ri-issuer-catalog.adapter').StocksRiIssuerCatalogAdapter)(
			stockService,
			b3Registry
		);

		await adapter.resolveByTicker('PETR4');

		expect(b3Registry.resolveCnpj).not.toHaveBeenCalled();
	});

	it('returns null when neither Brapi nor the B3 registry has a cnpj', async () => {
		const stockService = {
			getNationalQuote: jest.fn().mockResolvedValue({
				results: [{ symbol: 'ZZZZ9', cnpj: null }],
			}),
		};
		const b3Registry = { resolveCnpj: jest.fn().mockResolvedValue(null) };
		const adapter = new (require('./stocks-ri-issuer-catalog.adapter').StocksRiIssuerCatalogAdapter)(
			stockService,
			b3Registry
		);

		const result = await adapter.resolveByTicker('ZZZZ9');

		expect(result).toBeNull();
	});

	it('does not poison the 6h negative cache when the B3 registry lookup itself fails (transient), so a later lookup retries it', async () => {
		const stockService = {
			getNationalQuote: jest.fn().mockResolvedValue({
				results: [{ symbol: 'WXYZ3', cnpj: null }],
			}),
		};
		const b3Registry = {
			resolveCnpj: jest
				.fn()
				.mockRejectedValueOnce(new Error('b3 registry unreachable'))
				.mockResolvedValueOnce({
					cnpj: '98765432000111',
					company: 'Empresa Recuperada S.A.',
				}),
		};
		const adapter = new (require('./stocks-ri-issuer-catalog.adapter').StocksRiIssuerCatalogAdapter)(
			stockService,
			b3Registry
		);

		const first = await adapter.resolveByTicker('WXYZ3');
		expect(first).toBeNull();

		// Uma segunda tentativa logo em seguida deve tentar o registro B3 de
		// novo (não deve estar servindo um cache negativo de 6h construído a
		// partir de uma falha transitória de rede).
		const second = await adapter.resolveByTicker('WXYZ3');

		expect(b3Registry.resolveCnpj).toHaveBeenCalledTimes(2);
		expect(second).toEqual({
			ticker: 'WXYZ3',
			company: 'Empresa Recuperada S.A.',
			cnpj: '98765432000111',
		});
	});

	it('does write the 6h negative cache when the B3 registry loads successfully but genuinely has no match', async () => {
		const stockService = {
			getNationalQuote: jest.fn().mockResolvedValue({
				results: [{ symbol: 'NOPE3', cnpj: null }],
			}),
		};
		const b3Registry = { resolveCnpj: jest.fn().mockResolvedValue(null) };
		const adapter = new (require('./stocks-ri-issuer-catalog.adapter').StocksRiIssuerCatalogAdapter)(
			stockService,
			b3Registry
		);

		const first = await adapter.resolveByTicker('NOPE3');
		const second = await adapter.resolveByTicker('NOPE3');

		expect(first).toBeNull();
		expect(second).toBeNull();
		// Cache negativo válido (registro carregou com sucesso, ticker
		// genuinamente ausente): segunda chamada não deve re-consultar nada.
		expect(b3Registry.resolveCnpj).toHaveBeenCalledTimes(1);
		expect(stockService.getNationalQuote).toHaveBeenCalledTimes(1);
	});
});
