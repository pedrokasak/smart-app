import { CoinGeckoCryptoQuoteSource } from './coingecko-crypto-quote.source';

/** TRA-252: LUNC é Terra Classic, cotada em BRL pela CoinGecko. */
describe('CoinGeckoCryptoQuoteSource', () => {
	const build = (body: unknown, ok = true) => {
		const source = new CoinGeckoCryptoQuoteSource();
		const fetchImpl = jest.fn().mockResolvedValue({
			ok,
			status: ok ? 200 : 429,
			json: async () => body,
		});
		source.fetchImpl = fetchImpl as never;
		return { source, fetchImpl };
	};

	it('cota LUNC como Terra Classic e LUNA como Terra 2.0 numa chamada só', async () => {
		const { source, fetchImpl } = build({
			'terra-luna': { brl: 0.00027588, last_updated_at: 1790000000 },
			'terra-luna-2': { brl: 0.2676 },
		});

		const records = await source.quote(['lunc', 'LUNA']);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(String(fetchImpl.mock.calls[0][0])).toContain(
			'ids=terra-luna,terra-luna-2'
		);
		expect(records).toEqual([
			{
				symbol: 'LUNC',
				lastPrice: 0.00027588,
				lastQuoteAt: new Date(1790000000 * 1000),
				source: 'coingecko',
			},
			expect.objectContaining({ symbol: 'LUNA', lastPrice: 0.2676 }),
		]);
	});

	it('símbolo sem id conhecido fica de fora, sem chamada', async () => {
		const { source, fetchImpl } = build({});

		await expect(source.quote(['XYZ'])).resolves.toEqual([]);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('CoinGecko fora do ar devolve vazio em vez de lançar', async () => {
		const { source } = build({}, false);

		await expect(source.quote(['BTC'])).resolves.toEqual([]);
	});
});
