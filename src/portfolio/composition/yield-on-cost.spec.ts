import { computeYieldOnCost, dividendsPerShareInWindow } from './yield-on-cost';

const NOW = new Date('2025-06-30T12:00:00.000Z').getTime();
const daysAgo = (days: number) =>
	new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

describe('dividendsPerShareInWindow', () => {
	it('soma so os proventos dos ultimos 12 meses', () => {
		const total = dividendsPerShareInWindow(
			[
				{ date: daysAgo(30), value: 0.5 },
				{ date: daysAgo(200), value: 0.4 },
				// Fora da janela.
				{ date: daysAgo(400), value: 10 },
			],
			NOW
		);

		expect(total).toBeCloseTo(0.9, 6);
	});

	it('ignora provento com data futura', () => {
		const total = dividendsPerShareInWindow(
			[
				{ date: daysAgo(30), value: 0.5 },
				{ date: daysAgo(-10), value: 99 },
			],
			NOW
		);

		expect(total).toBeCloseTo(0.5, 6);
	});

	it('ignora valor invalido, zero ou negativo', () => {
		const total = dividendsPerShareInWindow(
			[
				{ date: daysAgo(10), value: 0.5 },
				{ date: daysAgo(20), value: 0 },
				{ date: daysAgo(30), value: -1 },
				{ date: daysAgo(40) },
			],
			NOW
		);

		expect(total).toBeCloseTo(0.5, 6);
	});

	it('ignora data invalida sem quebrar', () => {
		const total = dividendsPerShareInWindow(
			[
				{ date: 'nao-e-data', value: 5 },
				{ date: daysAgo(10), value: 0.5 },
			],
			NOW
		);

		expect(total).toBeCloseTo(0.5, 6);
	});

	it('devolve zero sem historico', () => {
		expect(dividendsPerShareInWindow(null, NOW)).toBe(0);
		expect(dividendsPerShareInWindow([], NOW)).toBe(0);
	});
});

describe('computeYieldOnCost', () => {
	// O ponto do modulo: quem comprou barato rende mais sobre o proprio
	// dinheiro do que o yield de mercado sugere.
	it('separa rendimento sobre custo de rendimento sobre cotacao', () => {
		const result = computeYieldOnCost(
			[
				{
					symbol: 'ITSA4',
					quantity: 1000,
					price: 5, // comprou a 5
					currentPrice: 10, // hoje vale 10
					dividendHistory: [{ date: daysAgo(60), value: 0.6 }],
					createdAt: daysAgo(800),
				},
			],
			NOW
		);

		const [asset] = result.assets;
		// 0,60 sobre custo 5 = 12%; sobre mercado 10 = 6%.
		expect(asset.yieldOnCost).toBeCloseTo(0.12, 6);
		expect(asset.yieldOnMarket).toBeCloseTo(0.06, 6);
	});

	it('estima a renda anual pela quantidade atual', () => {
		const result = computeYieldOnCost(
			[
				{
					symbol: 'ITSA4',
					quantity: 1000,
					price: 5,
					currentPrice: 10,
					dividendHistory: [
						{ date: daysAgo(60), value: 0.3 },
						{ date: daysAgo(240), value: 0.3 },
					],
					createdAt: daysAgo(800),
				},
			],
			NOW
		);

		expect(result.estimatedAnnualIncome).toBeCloseTo(600, 2);
	});

	it('pondera o agregado pelo custo de cada posicao', () => {
		const result = computeYieldOnCost(
			[
				{
					symbol: 'A',
					quantity: 100,
					price: 10,
					currentPrice: 10,
					dividendHistory: [{ date: daysAgo(30), value: 1 }],
					createdAt: daysAgo(800),
				},
				{
					symbol: 'B',
					quantity: 100,
					price: 10,
					currentPrice: 10,
					dividendHistory: [],
					createdAt: daysAgo(800),
				},
			],
			NOW
		);

		// 100 de provento sobre 2000 de custo = 5%.
		expect(result.portfolioYieldOnCost).toBeCloseTo(0.05, 6);
	});

	// A premissa do agregado e quantidade constante nos 12 meses. Para posicao
	// nova isso superestima, e o consumidor precisa saber.
	it('marca como aproximado quando ha posicao mais nova que a janela', () => {
		const result = computeYieldOnCost(
			[
				{
					symbol: 'NOVA',
					quantity: 100,
					price: 10,
					currentPrice: 10,
					dividendHistory: [{ date: daysAgo(30), value: 1 }],
					createdAt: daysAgo(60),
				},
			],
			NOW
		);

		expect(result.approximated).toBe(true);
	});

	it('nao marca como aproximado quando todas as posicoes sao antigas', () => {
		const result = computeYieldOnCost(
			[
				{
					symbol: 'ANTIGA',
					quantity: 100,
					price: 10,
					currentPrice: 10,
					dividendHistory: [{ date: daysAgo(30), value: 1 }],
					createdAt: daysAgo(800),
				},
			],
			NOW
		);

		expect(result.approximated).toBe(false);
	});

	it('devolve null no yield quando falta custo ou cotacao', () => {
		const result = computeYieldOnCost(
			[
				{
					symbol: 'SEMPRECO',
					quantity: 100,
					price: 0,
					currentPrice: 0,
					dividendHistory: [{ date: daysAgo(30), value: 1 }],
				},
			],
			NOW
		);

		expect(result.assets[0].yieldOnCost).toBeNull();
		expect(result.assets[0].yieldOnMarket).toBeNull();
	});

	it('ignora posicao zerada', () => {
		const result = computeYieldOnCost(
			[{ symbol: 'ZERADA', quantity: 0, price: 10, currentPrice: 10 }],
			NOW
		);

		expect(result.assets).toHaveLength(0);
		expect(result.portfolioYieldOnCost).toBeNull();
	});

	it('devolve estado vazio sem ativos', () => {
		const result = computeYieldOnCost([], NOW);

		expect(result.assets).toEqual([]);
		expect(result.portfolioYieldOnCost).toBeNull();
		expect(result.estimatedAnnualIncome).toBe(0);
		expect(result.approximated).toBe(false);
	});
});
