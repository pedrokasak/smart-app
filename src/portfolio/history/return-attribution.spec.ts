import {
	ATTRIBUTION_ASSUMPTION,
	computeReturnAttribution,
} from './return-attribution';

const closes = (start: number, end: number) => [
	{ date: '2025-01-02', close: start },
	{ date: '2025-06-30', close: (start + end) / 2 },
	{ date: '2025-12-30', close: end },
];

describe('computeReturnAttribution', () => {
	it('pesa pelo valor de mercado no início e soma as contribuições', () => {
		const result = computeReturnAttribution({
			// Início: A = 100×10 = 1000, B = 100×30 = 3000 → pesos 25% / 75%.
			positions: [
				{ symbol: 'AAAA3', quantity: 100 },
				{ symbol: 'BBBB3', quantity: 100 },
			],
			closesBySymbol: {
				AAAA3: closes(10, 12), // +20%
				BBBB3: closes(30, 27), // -10%
			},
		});

		const a = result.rows.find((r) => r.symbol === 'AAAA3');
		const b = result.rows.find((r) => r.symbol === 'BBBB3');
		expect(a?.startWeight).toBeCloseTo(0.25, 6);
		expect(a?.contribution).toBeCloseTo(0.05, 6); // 25% × 20%
		expect(b?.contribution).toBeCloseTo(-0.075, 6); // 75% × -10%
		expect(result.totalReturn).toBeCloseTo(-0.025, 6);
	});

	// O retorno total tem que bater com comprar e segurar a carteira de hoje.
	it('bate com o retorno de comprar e segurar a cesta atual', () => {
		const result = computeReturnAttribution({
			positions: [
				{ symbol: 'AAAA3', quantity: 100 },
				{ symbol: 'BBBB3', quantity: 50 },
			],
			closesBySymbol: { AAAA3: closes(10, 12), BBBB3: closes(40, 44) },
		});

		const startValue = 100 * 10 + 50 * 40;
		const endValue = 100 * 12 + 50 * 44;
		expect(result.totalReturn).toBeCloseTo(endValue / startValue - 1, 6);
	});

	it('ordena da maior contribuição para a menor e aponta os extremos', () => {
		const result = computeReturnAttribution({
			positions: [
				{ symbol: 'PERDE3', quantity: 100 },
				{ symbol: 'GANHA3', quantity: 100 },
			],
			closesBySymbol: { PERDE3: closes(10, 8), GANHA3: closes(10, 13) },
		});

		expect(result.rows.map((r) => r.symbol)).toEqual(['GANHA3', 'PERDE3']);
		expect(result.topContributor?.symbol).toBe('GANHA3');
		expect(result.topDetractor?.symbol).toBe('PERDE3');
	});

	// Detrator só existe quando alguém tirou retorno.
	it('não aponta detrator quando todos contribuíram positivamente', () => {
		const result = computeReturnAttribution({
			positions: [
				{ symbol: 'AAAA3', quantity: 100 },
				{ symbol: 'BBBB3', quantity: 100 },
			],
			closesBySymbol: { AAAA3: closes(10, 11), BBBB3: closes(10, 12) },
		});

		expect(result.topDetractor).toBeNull();
	});

	it('usa a cotação atual no fim da janela quando ela existe', () => {
		const result = computeReturnAttribution({
			positions: [{ symbol: 'AAAA3', quantity: 100, currentPrice: 15 }],
			closesBySymbol: { AAAA3: closes(10, 12) },
		});

		expect(result.rows[0].endPrice).toBe(15);
		expect(result.rows[0].assetReturn).toBeCloseTo(0.5, 6);
	});

	it('declara o ativo sem histórico e o exclui dos pesos', () => {
		const result = computeReturnAttribution({
			positions: [
				{ symbol: 'AAAA3', quantity: 100 },
				{ symbol: 'SEMHIST3', quantity: 100 },
			],
			closesBySymbol: { AAAA3: closes(10, 12) },
		});

		expect(result.missingSymbols).toEqual(['SEMHIST3']);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0].startWeight).toBeCloseTo(1, 6);
	});

	// A premissa vai junto: a resposta tem que dizer que aportes e vendas no
	// período não entram.
	it('declara a premissa de quantidade atual mantida na janela', () => {
		const result = computeReturnAttribution({
			positions: [{ symbol: 'AAAA3', quantity: 100 }],
			closesBySymbol: { AAAA3: closes(10, 12) },
		});

		expect(result.assumptions).toContain(ATTRIBUTION_ASSUMPTION);
	});

	it('ignora posição zerada e devolve estado vazio sem dado', () => {
		const result = computeReturnAttribution({
			positions: [{ symbol: 'ZERADA3', quantity: 0 }],
			closesBySymbol: { ZERADA3: closes(10, 12) },
		});

		expect(result.rows).toEqual([]);
		expect(result.totalReturn).toBeNull();
		expect(result.topContributor).toBeNull();
	});
});
