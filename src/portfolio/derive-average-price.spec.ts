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
});
