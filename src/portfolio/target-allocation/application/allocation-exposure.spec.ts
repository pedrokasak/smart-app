import {
	computeBucketExposure,
	positionValue,
	toAllocationBucket,
} from './allocation-exposure';

describe('allocation-exposure', () => {
	it('mapeia o tipo do ativo para o balde da meta', () => {
		expect(toAllocationBucket('stock')).toBe('stocks');
		expect(toAllocationBucket('fii')).toBe('fiis');
		expect(toAllocationBucket('crypto')).toBe('crypto');
		// ETF e fundo nao tem balde proprio na meta (TRA-68).
		expect(toAllocationBucket('etf')).toBe('other');
		expect(toAllocationBucket('fund')).toBe('other');
		expect(toAllocationBucket(undefined)).toBe('other');
	});

	it('carteira valorizada pesa pelo valor de mercado, nao pelo custo', () => {
		const exposure = computeBucketExposure([
			{ type: 'crypto', quantity: 1, total: 1000, currentPrice: 10000 },
			{ type: 'stock', quantity: 100, total: 10000, currentPrice: 100 },
		]);

		expect(exposure.crypto).toBeCloseTo(50, 5);
		expect(exposure.stocks).toBeCloseTo(50, 5);
	});

	it('prefere cotacao atual, depois total, depois preco de entrada', () => {
		expect(positionValue({ total: 500, quantity: 2, currentPrice: 10 })).toBe(
			20
		);
		expect(positionValue({ total: 500, quantity: 2, price: 4 })).toBe(500);
		expect(positionValue({ quantity: 2, currentPrice: 10, price: 4 })).toBe(20);
		expect(positionValue({ quantity: 2, price: 4 })).toBe(8);
	});

	it('nao inventa preco: posicao sem valor conhecido vale zero', () => {
		expect(positionValue({ quantity: 10 })).toBe(0);
		expect(positionValue({})).toBe(0);
	});

	it('devolve percentual por balde', () => {
		const exposicao = computeBucketExposure([
			{ type: 'stock', total: 50 },
			{ type: 'crypto', total: 25 },
			{ type: 'fii', total: 25 },
		]);

		expect(exposicao).toEqual({ stocks: 50, crypto: 25, fiis: 25, other: 0 });
	});

	/** Dividir por zero viraria NaN no payload — evento invalido. */
	it('carteira sem valor devolve zeros, nunca NaN', () => {
		const exposicao = computeBucketExposure([{ type: 'stock', quantity: 3 }]);

		expect(exposicao).toEqual({ stocks: 0, crypto: 0, fiis: 0, other: 0 });
	});

	it('lista vazia nao quebra', () => {
		expect(computeBucketExposure([])).toEqual({
			stocks: 0,
			crypto: 0,
			fiis: 0,
			other: 0,
		});
	});
});
