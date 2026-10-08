import { AssetMapper } from './asset.mapper';

function asset(overrides: Record<string, unknown> = {}) {
	return {
		_id: { toString: () => 'a1' },
		portfolioId: { toString: () => 'p1' },
		symbol: 'PETR4',
		type: 'stock',
		quantity: 10,
		price: 30,
		total: 300,
		source: 'manual',
		createdAt: new Date('2026-01-01'),
		updatedAt: new Date('2026-01-02'),
		...overrides,
	} as any;
}

describe('AssetMapper — beta (TRA-251)', () => {
	it('expõe o beta calculado como indicators.beta, mantendo os outros indicadores', () => {
		const dto = AssetMapper.toResponseDto(
			asset({
				indicators: { dividendYield: 0.1 },
				beta: 1.23,
				betaBenchmark: 'BOVA11',
				betaAsOf: '2026-10-06',
			})
		);

		expect(dto.indicators).toEqual({ dividendYield: 0.1, beta: 1.23 });
		expect(dto.betaBenchmark).toBe('BOVA11');
		expect(dto.betaAsOf).toBe('2026-10-06');
	});

	it('mesmo sem outros indicadores, o beta chega ao front', () => {
		const dto = AssetMapper.toResponseDto(asset({ beta: 0.8 }));

		expect(dto.indicators).toEqual({ beta: 0.8 });
	});

	it('beta zero é um beta válido, não ausência', () => {
		expect(AssetMapper.toResponseDto(asset({ beta: 0 })).indicators?.beta).toBe(
			0
		);
	});

	it('sem beta calculado (null), indicators fica como estava', () => {
		const dto = AssetMapper.toResponseDto(
			asset({ indicators: { dividendYield: 0.1 }, beta: null })
		);

		expect(dto.indicators).toEqual({ dividendYield: 0.1 });
		expect(dto.betaBenchmark).toBeUndefined();
	});
});
