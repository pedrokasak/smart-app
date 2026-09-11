import { computeRebalancingGap } from './rebalancing-gap';

const position = (type: string, quantity: number, currentPrice: number) => ({
	type,
	quantity,
	currentPrice,
	price: currentPrice,
	total: quantity * currentPrice,
});

describe('computeRebalancingGap', () => {
	it('calcula desvio em pontos percentuais e em reais', () => {
		const result = computeRebalancingGap({
			// 6000 em acao, 4000 em FII = 60/40.
			positions: [position('stock', 100, 60), position('fii', 100, 40)],
			target: { stocks: 70, fiis: 30 },
		});

		expect(result.totalValue).toBe(10000);

		const stocks = result.buckets.find((b) => b.bucket === 'stocks');
		expect(stocks?.currentPct).toBeCloseTo(60, 2);
		expect(stocks?.targetPct).toBe(70);
		// Falta 10pp de acao: comprar 1000.
		expect(stocks?.gapPct).toBeCloseTo(10, 2);
		expect(stocks?.amount).toBeCloseTo(1000, 2);

		const fiis = result.buckets.find((b) => b.bucket === 'fiis');
		// Sobra 10pp de FII: vender 1000.
		expect(fiis?.gapPct).toBeCloseTo(-10, 2);
		expect(fiis?.amount).toBeCloseTo(-1000, 2);
	});

	// Convencao de sinal: positivo = falta comprar. Sem isso o usuario nao sabe
	// a direcao do ajuste.
	it('usa sinal positivo para o que falta comprar', () => {
		const result = computeRebalancingGap({
			positions: [position('stock', 100, 100)],
			target: { stocks: 50, crypto: 50 },
		});

		const crypto = result.buckets.find((b) => b.bucket === 'crypto');
		expect(crypto?.currentPct).toBe(0);
		expect(crypto?.gapPct).toBeCloseTo(50, 2);
		expect(crypto?.amount).toBeCloseTo(5000, 2);
	});

	it('soma os desvios absolutos no drift total', () => {
		const result = computeRebalancingGap({
			positions: [position('stock', 100, 60), position('fii', 100, 40)],
			target: { stocks: 70, fiis: 30 },
		});

		// |10| + |-10|
		expect(result.totalDriftPct).toBeCloseTo(20, 2);
	});

	it('aponta o balde mais distante da meta', () => {
		const result = computeRebalancingGap({
			positions: [
				position('stock', 100, 50),
				position('fii', 100, 30),
				position('crypto', 100, 20),
			],
			target: { stocks: 50, fiis: 30, crypto: 20 },
		});

		// 50/30/20 atual contra 50/30/20 alvo: tudo alinhado.
		expect(result.totalDriftPct).toBeCloseTo(0, 2);
		expect(result.largestGap?.gapPct).toBeCloseTo(0, 2);
	});

	// Balde ausente da meta nao e meta zero: o usuario nao opinou sobre ele.
	// Entrar com 0 acusaria desvio de toda a posicao.
	it('ignora balde que nao esta na meta, em vez de tratar como zero', () => {
		const result = computeRebalancingGap({
			positions: [position('stock', 100, 50), position('crypto', 100, 50)],
			target: { stocks: 100 },
		});

		expect(result.buckets.map((b) => b.bucket)).toEqual(['stocks']);
		// Cripto nao aparece como desvio de -50pp.
		expect(result.totalDriftPct).toBeCloseTo(50, 2);
	});

	// Devolver zeros sugeriria carteira alinhada a uma politica que nao existe.
	it('declara ausencia de meta em vez de fingir alinhamento', () => {
		const result = computeRebalancingGap({
			positions: [position('stock', 100, 50)],
			target: null,
		});

		expect(result.hasTarget).toBe(false);
		expect(result.buckets).toEqual([]);
		expect(result.largestGap).toBeNull();
		// O valor total continua util para a tela.
		expect(result.totalValue).toBe(5000);
	});

	it('nao quebra com carteira vazia', () => {
		const result = computeRebalancingGap({
			positions: [],
			target: { stocks: 100 },
		});

		expect(result.totalValue).toBe(0);
		expect(result.buckets[0].currentPct).toBe(0);
		expect(result.buckets[0].amount).toBe(0);
	});

	it('trata ETF e fundo como other, igual ao alerta de alocacao', () => {
		const result = computeRebalancingGap({
			positions: [position('etf', 100, 50), position('stock', 100, 50)],
			target: { stocks: 50, other: 50 },
		});

		const other = result.buckets.find((b) => b.bucket === 'other');
		expect(other?.currentPct).toBeCloseTo(50, 2);
		expect(other?.gapPct).toBeCloseTo(0, 2);
	});
});
