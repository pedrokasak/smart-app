import { computePortfolioSnapshot } from './compute-snapshot';

describe('computePortfolioSnapshot', () => {
	// O defeito que motivou TRA-143: o snapshot somava `asset.total`, que é
	// quantity * costBasis. Custo nao varia sem negociacao, entao a serie
	// gravava o mesmo numero todo dia e o grafico saia reto.
	it('valoriza a mercado, nao pelo custo de aquisicao', () => {
		const result = computePortfolioSnapshot([
			{ symbol: 'PETR4', quantity: 100, price: 30, currentPrice: 40 },
		]);

		expect(result.totalValue).toBe(4000);
		expect(result.investedValue).toBe(3000);
		expect(result.stale).toBe(false);
	});

	// Separar os dois e o que torna a decomposicao "aporte vs rendimento"
	// possivel sem calculo novo (TRA-146).
	it('separa valor de mercado de custo, somando varios ativos', () => {
		const result = computePortfolioSnapshot([
			{ symbol: 'PETR4', quantity: 100, price: 30, currentPrice: 40 },
			{ symbol: 'VALE3', quantity: 50, price: 60, currentPrice: 55 },
		]);

		expect(result.totalValue).toBe(4000 + 2750);
		expect(result.investedValue).toBe(3000 + 3000);
		expect(result.pricedAssets).toBe(2);
	});

	it('marca o snapshot quando falta cotacao e diz qual simbolo faltou', () => {
		const result = computePortfolioSnapshot([
			{ symbol: 'PETR4', quantity: 100, price: 30, currentPrice: 40 },
			{ symbol: 'XPTO11', quantity: 10, price: 100, currentPrice: null },
		]);

		expect(result.stale).toBe(true);
		expect(result.staleSymbols).toEqual(['XPTO11']);
		// O ativo sem cotacao entra pelo custo — mas o snapshot avisa.
		expect(result.totalValue).toBe(4000 + 1000);
	});

	it('trata cotacao ausente, zero e nao-numerica como sem cotacao', () => {
		const semCotacao = computePortfolioSnapshot([
			{ symbol: 'A', quantity: 1, price: 10 },
			{ symbol: 'B', quantity: 1, price: 10, currentPrice: 0 },
			{ symbol: 'C', quantity: 1, price: 10, currentPrice: NaN },
		]);

		expect(semCotacao.stale).toBe(true);
		expect(semCotacao.staleSymbols).toEqual(['A', 'B', 'C']);
		expect(semCotacao.totalValue).toBe(30);
	});

	it('ignora posicao zerada ou negativa', () => {
		const result = computePortfolioSnapshot([
			{ symbol: 'PETR4', quantity: 0, price: 30, currentPrice: 40 },
			{ symbol: 'VALE3', quantity: -5, price: 60, currentPrice: 55 },
			{ symbol: 'ITUB4', quantity: 10, price: 20, currentPrice: 25 },
		]);

		expect(result.pricedAssets).toBe(1);
		expect(result.totalValue).toBe(250);
		expect(result.investedValue).toBe(200);
	});

	it('devolve zeros para carteira vazia sem marcar como stale', () => {
		const result = computePortfolioSnapshot([]);

		expect(result.totalValue).toBe(0);
		expect(result.investedValue).toBe(0);
		expect(result.stale).toBe(false);
		expect(result.staleSymbols).toEqual([]);
	});

	it('nao repete o mesmo simbolo na lista de faltantes', () => {
		const result = computePortfolioSnapshot([
			{ symbol: 'XPTO11', quantity: 10, price: 100 },
			{ symbol: 'xpto11', quantity: 5, price: 100 },
		]);

		expect(result.staleSymbols).toEqual(['XPTO11']);
	});

	// Uma carteira toda sem cotacao vale o custo — e precisa dizer isso, senao
	// e indistinguivel de uma carteira que nao rendeu nada.
	it('marca como stale quando nenhum ativo tem cotacao', () => {
		const result = computePortfolioSnapshot([
			{ symbol: 'A', quantity: 10, price: 10 },
			{ symbol: 'B', quantity: 10, price: 20 },
		]);

		expect(result.totalValue).toBe(result.investedValue);
		expect(result.stale).toBe(true);
	});
});
