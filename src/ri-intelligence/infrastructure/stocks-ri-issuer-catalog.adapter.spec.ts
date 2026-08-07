import { StocksRiIssuerCatalogAdapter } from 'src/ri-intelligence/infrastructure/stocks-ri-issuer-catalog.adapter';
import { StockService } from 'src/stocks/stocks.service';

describe('StocksRiIssuerCatalogAdapter', () => {
	function makeStockService(quote: any) {
		return {
			getNationalQuote: jest.fn(async () => quote),
		} as unknown as StockService;
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
		const adapter = new StocksRiIssuerCatalogAdapter(stockService);

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
		const adapter = new StocksRiIssuerCatalogAdapter(stockService);

		const ref = await adapter.resolveByTicker('vale3.SA');

		expect(ref?.ticker).toBe('VALE3');
		expect(ref?.cnpj).toBe('33602724000134');
		expect(stockService.getNationalQuote).toHaveBeenCalledWith('VALE3', {
			fundamental: true,
		});
	});

	it('returns null and skips CVM when the quote has no CNPJ', async () => {
		const stockService = makeStockService({
			results: [{ symbol: 'XXXX3', longName: 'Sem CNPJ SA' }],
		});
		const adapter = new StocksRiIssuerCatalogAdapter(stockService);

		const ref = await adapter.resolveByTicker('XXXX3');

		expect(ref).toBeNull();
	});

	it('returns null when Brapi lookup fails', async () => {
		const stockService = {
			getNationalQuote: jest.fn().mockRejectedValue(new Error('brapi down')),
		} as unknown as StockService;
		const adapter = new StocksRiIssuerCatalogAdapter(stockService);

		const ref = await adapter.resolveByTicker('ITUB4');

		expect(ref).toBeNull();
	});

	it('dedups concurrent resolutions for the same ticker (in-flight cache)', async () => {
		const stockService = makeStockService({
			results: [{ symbol: 'ITUB4', cnpj: '60.872.504/0001-23' }],
		});
		const adapter = new StocksRiIssuerCatalogAdapter(stockService);

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
