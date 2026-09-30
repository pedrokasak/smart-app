import { QuotableAsset, applyLatestQuotes } from './market-quote-overlay';

/** TRA-247: a carteira mostrava o fechamento do relatório, não a cotação. */
describe('applyLatestQuotes', () => {
	const vbbr3: QuotableAsset = {
		symbol: 'VBBR3',
		type: 'stock',
		quantity: 73.9,
		// Fechamento de 30/12/2025 vindo do consolidado anual da B3.
		price: 25.33,
		total: 1872.03,
		currentPrice: undefined,
		lastEnrichedAt: undefined,
	};

	it('usa a cotação do cache e recalcula o valor da posição', () => {
		const [asset] = applyLatestQuotes(
			[vbbr3],
			[
				{
					symbol: 'VBBR3',
					lastQuoteAt: new Date('2026-09-26T11:49:00Z'),
					lastPrice: 37.21,
					source: 'primary',
				},
			]
		);

		expect(asset.currentPrice).toBe(37.21);
		expect(asset.total).toBe(2749.82);
		expect(asset.quoteAsOf).toBe('2026-09-26T11:49:00.000Z');
		expect(asset.quoteSource).toBe('primary');
		// O fechamento do relatório continua disponível como referência.
		expect(asset.price).toBe(25.33);
	});

	it('não troca uma cotação mais nova do próprio ativo por uma leitura velha', () => {
		const [asset] = applyLatestQuotes(
			[
				{
					...vbbr3,
					currentPrice: 38,
					lastEnrichedAt: new Date('2026-09-27T12:00:00Z'),
				},
			],
			[
				{
					symbol: 'VBBR3',
					lastQuoteAt: new Date('2026-09-20T12:00:00Z'),
					lastPrice: 30,
				},
			]
		);

		expect(asset.currentPrice).toBe(38);
		expect(asset.total).toBe(2808.2);
		expect(asset.quoteAsOf).toBeUndefined();
	});

	it('sem cotação nenhuma, mantém o valor gravado', () => {
		const [asset] = applyLatestQuotes([vbbr3], []);

		expect(asset.total).toBe(1872.03);
		expect(asset.currentPrice).toBeUndefined();
	});

	it('renda fixa não recebe cotação de mercado', () => {
		const lca = {
			...vbbr3,
			symbol: '25F08539417',
			type: 'fund',
			price: 1068.35,
			total: 1068.35,
			quantity: 1,
		};

		const [asset] = applyLatestQuotes(
			[lca],
			[{ symbol: '25F08539417', lastQuoteAt: new Date(), lastPrice: 999 }]
		);

		expect(asset).toBe(lca);
	});

	it('ignora leitura sem preço e casa símbolo sem diferenciar maiúsculas', () => {
		const [withoutPrice] = applyLatestQuotes(
			[vbbr3],
			[{ symbol: 'VBBR3', lastQuoteAt: new Date(), lastPrice: null }]
		);
		expect(withoutPrice.total).toBe(1872.03);

		const [lowercase] = applyLatestQuotes(
			[{ ...vbbr3, symbol: 'vbbr3' }],
			[{ symbol: 'VBBR3', lastQuoteAt: new Date(), lastPrice: 40 }]
		);
		expect(lowercase.currentPrice).toBe(40);
	});

	// TRA-252: o cache chegou a guardar um papel homônimo para "LUNC".
	it('cripto nunca recebe a cotação do cache de ações', () => {
		const lunc: QuotableAsset = {
			symbol: 'LUNC',
			type: 'crypto',
			quantity: 1092.963942,
			price: 0.0003,
			total: 0.33,
		};

		const [asset] = applyLatestQuotes(
			[lunc],
			[{ symbol: 'LUNC', lastQuoteAt: new Date(), lastPrice: 24.9 }]
		);

		expect(asset).toBe(lunc);
	});
});
