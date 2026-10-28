import { splitProventosByType } from './proventos';

describe('splitProventosByType', () => {
	const assets = [
		{
			symbol: 'itsa4',
			dividendHistory: [
				{ date: '2026-03-10', value: 10, paymentType: 'DIVIDEND' },
				{ date: '2026-06-10', value: 5.555, paymentType: 'JCP' },
				{ date: '2026-09-10', value: 2, paymentType: 'JCP' },
				{ date: '2025-12-30', value: 99, paymentType: 'JCP' },
			],
		},
		{
			symbol: 'HGLG11',
			dividendHistory: [
				{ date: '2026-01-15', value: 7, paymentType: 'RENDIMENTO' },
				{ date: '2026-02-15', value: 3 },
			],
		},
	];

	it('separa JCP do total de dividendos', () => {
		const result = splitProventosByType(assets, 2026);

		expect(result.jcp).toEqual([{ symbol: 'ITSA4', total: 7.56 }]);
		expect(result.dividends).toEqual([
			{ symbol: 'HGLG11', total: 10 },
			{ symbol: 'ITSA4', total: 10 },
		]);
	});

	it('mantém RENDIMENTO e lançamento sem tipo fora do JCP', () => {
		const result = splitProventosByType(assets, 2026);

		expect(result.jcp.find((item) => item.symbol === 'HGLG11')).toBeUndefined();
	});

	it('ignora outros anos, valores inválidos e ativos sem símbolo', () => {
		const result = splitProventosByType(
			[
				{ symbol: '', dividendHistory: [{ date: '2026-01-01', value: 5 }] },
				{
					symbol: 'VALE3',
					dividendHistory: [
						{ date: '2026-01-01', value: 0 },
						{ date: '2026-01-01', value: -3 },
						{ date: '2026-01-01', value: Number.NaN },
						{ date: 'lixo', value: 4 },
						{ date: null, value: 4 },
					],
				},
				{ symbol: 'PETR4', dividendHistory: null },
			],
			2026
		);

		expect(result).toEqual({ dividends: [], jcp: [] });
	});

	it('aceita lista de ativos ausente', () => {
		expect(splitProventosByType(undefined as unknown as [], 2026)).toEqual({
			dividends: [],
			jcp: [],
		});
	});
});
