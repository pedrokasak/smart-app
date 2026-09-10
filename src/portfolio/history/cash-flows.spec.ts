import {
	computeDailyCashFlows,
	netContributionUntil,
	tradeCashFlow,
} from './cash-flows';

describe('cash-flows', () => {
	describe('tradeCashFlow', () => {
		it('compra entra positivo, somando taxas', () => {
			expect(
				tradeCashFlow({
					side: 'buy',
					quantity: 100,
					price: 30,
					fees: 5,
					date: '2025-01-10',
				})
			).toBe(3005);
		});

		it('venda sai negativo, descontando taxas do que voltou', () => {
			expect(
				tradeCashFlow({
					side: 'sell',
					quantity: 100,
					price: 40,
					fees: 5,
					date: '2025-02-10',
				})
			).toBe(-3995);
		});

		it('ignora negocio sem quantidade', () => {
			expect(
				tradeCashFlow({ side: 'buy', quantity: 0, price: 30, date: '2025-01-10' })
			).toBe(0);
		});
	});

	describe('computeDailyCashFlows', () => {
		it('agrega varios negocios do mesmo dia num fluxo so', () => {
			const series = computeDailyCashFlows([
				{ side: 'buy', quantity: 100, price: 30, date: '2025-01-10' },
				{ side: 'buy', quantity: 50, price: 20, date: '2025-01-10' },
			]);

			expect(series.byDay).toEqual([{ date: '2025-01-10', flow: 4000 }]);
			expect(series.netContribution).toBe(4000);
		});

		it('ordena os dias cronologicamente', () => {
			const series = computeDailyCashFlows([
				{ side: 'buy', quantity: 1, price: 100, date: '2025-03-01' },
				{ side: 'buy', quantity: 1, price: 100, date: '2025-01-01' },
				{ side: 'buy', quantity: 1, price: 100, date: '2025-02-01' },
			]);

			expect(series.byDay.map((p) => p.date)).toEqual([
				'2025-01-01',
				'2025-02-01',
				'2025-03-01',
			]);
		});

		// O ponto central do modulo: vender com lucro devolve mais caixa do que
		// o custo que sai da carteira. Tratar custo como fluxo erra o retorno.
		it('venda com lucro sai pelo caixa recebido, nao pelo custo', () => {
			const series = computeDailyCashFlows([
				{ side: 'buy', quantity: 100, price: 30, date: '2025-01-10' },
				{ side: 'sell', quantity: 100, price: 50, date: '2025-06-10' },
			]);

			// Entrou 3000, voltou 5000 — contribuicao liquida negativa em 2000.
			expect(series.netContribution).toBe(-2000);
		});

		it('marca covered=false quando nao ha negociacao alguma', () => {
			const series = computeDailyCashFlows([]);

			expect(series.covered).toBe(false);
			expect(series.byDay).toEqual([]);
			expect(series.netContribution).toBe(0);
		});

		it('ignora data invalida sem quebrar', () => {
			const series = computeDailyCashFlows([
				{ side: 'buy', quantity: 1, price: 100, date: 'nao-e-data' },
				{ side: 'buy', quantity: 1, price: 100, date: '2025-01-01' },
			]);

			expect(series.byDay).toHaveLength(1);
			expect(series.netContribution).toBe(100);
		});

		it('aceita Date alem de string', () => {
			const series = computeDailyCashFlows([
				{
					side: 'buy',
					quantity: 1,
					price: 100,
					date: new Date('2025-01-01T13:00:00Z'),
				},
			]);

			expect(series.byDay[0].date).toBe('2025-01-01');
		});
	});

	describe('netContributionUntil', () => {
		const series = computeDailyCashFlows([
			{ side: 'buy', quantity: 100, price: 30, date: '2025-01-10' },
			{ side: 'buy', quantity: 100, price: 10, date: '2025-03-10' },
			{ side: 'sell', quantity: 50, price: 60, date: '2025-06-10' },
		]);

		it('acumula so ate a data pedida, inclusive', () => {
			expect(netContributionUntil(series, '2025-01-09')).toBe(0);
			expect(netContributionUntil(series, '2025-01-10')).toBe(3000);
			expect(netContributionUntil(series, '2025-03-10')).toBe(4000);
			expect(netContributionUntil(series, '2025-06-10')).toBe(1000);
		});

		it('devolve o total quando a data e posterior a tudo', () => {
			expect(netContributionUntil(series, '2030-01-01')).toBe(
				series.netContribution
			);
		});
	});
});
