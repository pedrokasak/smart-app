import {
	withDerivedAveragePrice,
	type DerivableAsset,
} from './derive-average-price';

const trade = (
	symbol: string,
	side: 'buy' | 'sell',
	quantity: number,
	price: number,
	day: number,
	fees = 0
) => ({ symbol, side, quantity, price, fees, date: new Date(2026, 0, day) });

describe('withDerivedAveragePrice', () => {
	it('keeps a manually set average price', () => {
		const result = withDerivedAveragePrice<DerivableAsset>(
			[{ symbol: 'BBAS3', avgPrice: 30 }],
			[trade('BBAS3', 'buy', 100, 10, 1)]
		);

		expect(result[0].avgPrice).toBe(30);
	});

	it('derives the weighted average from trades when none is set', () => {
		const result = withDerivedAveragePrice<DerivableAsset>(
			[{ symbol: 'BBAS3' }],
			[trade('BBAS3', 'buy', 100, 10, 1), trade('BBAS3', 'buy', 100, 20, 2)]
		);

		expect(result[0].avgPrice).toBeCloseTo(15, 6);
	});

	it('includes fees in the derived cost', () => {
		const result = withDerivedAveragePrice<DerivableAsset>(
			[{ symbol: 'BBAS3' }],
			[trade('BBAS3', 'buy', 100, 10, 1, 50)]
		);

		expect(result[0].avgPrice).toBeCloseTo(10.5, 6);
	});

	it('treats a zero average price as unset and derives instead', () => {
		const result = withDerivedAveragePrice<DerivableAsset>(
			[{ symbol: 'BBAS3', avgPrice: 0 }],
			[trade('BBAS3', 'buy', 100, 10, 1)]
		);

		expect(result[0].avgPrice).toBeCloseTo(10, 6);
	});

	it('leaves the asset untouched when there are no trades for it', () => {
		const result = withDerivedAveragePrice<DerivableAsset>(
			[{ symbol: 'BBAS3' }],
			[trade('PETR4', 'buy', 100, 10, 1)]
		);

		expect(result[0].avgPrice).toBeUndefined();
	});

	it('matches symbols case insensitively', () => {
		const result = withDerivedAveragePrice<DerivableAsset>(
			[{ symbol: 'bbas3' }],
			[trade('BBAS3', 'buy', 100, 10, 1)]
		);

		expect(result[0].avgPrice).toBeCloseTo(10, 6);
	});

	it('leaves the average price unset when a full sale zeroed the position', () => {
		const result = withDerivedAveragePrice<DerivableAsset>(
			[{ symbol: 'BBAS3' }],
			[trade('BBAS3', 'buy', 100, 10, 1), trade('BBAS3', 'sell', 100, 12, 2)]
		);

		expect(result[0].avgPrice).toBeUndefined();
	});

	it('does not mutate the assets it receives', () => {
		const assets = [{ symbol: 'BBAS3' }];
		withDerivedAveragePrice(assets, [trade('BBAS3', 'buy', 100, 10, 1)]);

		expect(assets[0]).toEqual({ symbol: 'BBAS3' });
	});

	/**
	 * O importador consolidado antigo gravava `avgPrice = price` (a cotação
	 * de fechamento como se fosse custo), o que zera o P&L por construção.
	 * Remover aquela linha parou novas gravações mas não curou o banco.
	 */
	describe('custo corrompido pelo importador consolidado antigo', () => {
		it('recalcula pelas negociações quando o custo veio igual à cotação', () => {
			const result = withDerivedAveragePrice<DerivableAsset>(
				[{ symbol: 'BEEF3', avgPrice: 5.76, price: 5.76, source: 'b3' }],
				[trade('BEEF3', 'buy', 46, 4.5, 1)]
			);

			expect(result[0].avgPrice).toBeCloseTo(4.5, 6);
		});

		it('deixa o custo indefinido quando não há negociação para recalcular', () => {
			// Melhor "—" do que R$ 0,00: zero é uma afirmação, e é falsa.
			const result = withDerivedAveragePrice<DerivableAsset>(
				[{ symbol: 'BEEF3', avgPrice: 5.76, price: 5.76, source: 'b3' }],
				[]
			);

			expect(result[0].avgPrice).toBeUndefined();
		});

		it('preserva custo digitado à mão que por acaso é igual à cotação', () => {
			// `source: 'manual'` nunca passou pelo importador quebrado.
			const result = withDerivedAveragePrice<DerivableAsset>(
				[{ symbol: 'BEEF3', avgPrice: 5.76, price: 5.76, source: 'manual' }],
				[]
			);

			expect(result[0].avgPrice).toBe(5.76);
		});

		it('preserva custo de ativo b3 que difere da cotação', () => {
			// Diferente da cotação, então não é a assinatura da gravação errada.
			const result = withDerivedAveragePrice<DerivableAsset>(
				[{ symbol: 'BEEF3', avgPrice: 4.2, price: 5.76, source: 'b3' }],
				[]
			);

			expect(result[0].avgPrice).toBe(4.2);
		});

		it('não altera o ativo original ao tratar o custo corrompido', () => {
			const assets = [
				{ symbol: 'BEEF3', avgPrice: 5.76, price: 5.76, source: 'b3' },
			];
			withDerivedAveragePrice(assets, []);

			// O banco não é tocado: a decisão vale só para esta leitura.
			expect(assets[0].avgPrice).toBe(5.76);
		});
	});
});
