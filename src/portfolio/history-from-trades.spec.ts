import { buildHistoryFromTrades } from './history-from-trades';

const trade = (
	symbol: string,
	side: 'buy' | 'sell',
	quantity: number,
	price: number,
	date: string
) => ({ symbol, side, quantity, price, date });

const at = (points: ReturnType<typeof buildHistoryFromTrades>, day: string) =>
	points.find((point) => point.date === day);

describe('buildHistoryFromTrades', () => {
	it('devolve vazio sem negociação', () => {
		expect(buildHistoryFromTrades([], new Date('2025-06-01'))).toEqual([]);
	});

	it('começa na primeira negociação e vai até a data final', () => {
		const points = buildHistoryFromTrades(
			[trade('PETR4', 'buy', 10, 30, '2025-01-10')],
			new Date('2025-01-13')
		);

		expect(points.map((point) => point.date)).toEqual([
			'2025-01-10',
			'2025-01-11',
			'2025-01-12',
			'2025-01-13',
		]);
	});

	it('a curva se move quando há aporte, em vez de ficar reta', () => {
		const points = buildHistoryFromTrades(
			[
				trade('PETR4', 'buy', 10, 30, '2025-01-10'),
				trade('PETR4', 'buy', 10, 40, '2025-01-12'),
			],
			new Date('2025-01-13')
		);

		expect(at(points, '2025-01-10')!.totalValue).toBe(300);
		// 20 papéis ao último preço observado (40).
		expect(at(points, '2025-01-12')!.totalValue).toBe(800);
		expect(at(points, '2025-01-13')!.totalValue).toBe(800);
	});

	it('mantém a posição nos dias sem negociação', () => {
		const points = buildHistoryFromTrades(
			[trade('PETR4', 'buy', 10, 30, '2025-01-10')],
			new Date('2025-01-12')
		);

		expect(at(points, '2025-01-11')!.totalValue).toBe(300);
	});

	it('reduz a posição na venda', () => {
		const points = buildHistoryFromTrades(
			[
				trade('PETR4', 'buy', 10, 30, '2025-01-10'),
				trade('PETR4', 'sell', 4, 35, '2025-01-11'),
			],
			new Date('2025-01-11')
		);

		// 6 papéis ao último preço observado (35).
		expect(at(points, '2025-01-11')!.totalValue).toBe(210);
	});

	it('soma vários papéis na mesma série', () => {
		const points = buildHistoryFromTrades(
			[
				trade('PETR4', 'buy', 10, 30, '2025-01-10'),
				trade('VALE3', 'buy', 5, 60, '2025-01-11'),
			],
			new Date('2025-01-11')
		);

		expect(at(points, '2025-01-11')!.totalValue).toBe(600);
	});

	it('acompanha o valor investido líquido de vendas', () => {
		const points = buildHistoryFromTrades(
			[
				trade('PETR4', 'buy', 10, 30, '2025-01-10'),
				trade('PETR4', 'sell', 5, 40, '2025-01-11'),
			],
			new Date('2025-01-11')
		);

		expect(at(points, '2025-01-10')!.investedValue).toBe(300);
		// 300 investidos menos 200 devolvidos pela venda.
		expect(at(points, '2025-01-11')!.investedValue).toBe(100);
	});

	it('não deixa a posição ficar negativa com histórico incompleto', () => {
		// Venda sem a compra correspondente no arquivo: dado faltando, não
		// posição vendida.
		const points = buildHistoryFromTrades(
			[trade('PETR4', 'sell', 10, 30, '2025-01-10')],
			new Date('2025-01-10')
		);

		expect(at(points, '2025-01-10')!.totalValue).toBe(0);
	});

	it('zera o valor quando a posição é totalmente vendida', () => {
		const points = buildHistoryFromTrades(
			[
				trade('PETR4', 'buy', 10, 30, '2025-01-10'),
				trade('PETR4', 'sell', 10, 35, '2025-01-11'),
			],
			new Date('2025-01-11')
		);

		expect(at(points, '2025-01-11')!.totalValue).toBe(0);
	});

	it('ignora negociação com data inválida', () => {
		const points = buildHistoryFromTrades(
			[
				trade('PETR4', 'buy', 10, 30, '2025-01-10'),
				trade('VALE3', 'buy', 5, 60, 'data-invalida'),
			],
			new Date('2025-01-10')
		);

		expect(at(points, '2025-01-10')!.totalValue).toBe(300);
	});

	it('produz períodos distintos, que é o que faz 7D/1M/1A diferirem', () => {
		const points = buildHistoryFromTrades(
			[
				trade('PETR4', 'buy', 10, 10, '2025-01-10'),
				trade('PETR4', 'buy', 10, 20, '2025-06-10'),
				trade('PETR4', 'buy', 10, 30, '2025-11-10'),
			],
			new Date('2025-12-31')
		);

		const valores = new Set(points.map((point) => point.totalValue));
		// Mais de um valor distinto: a linha deixa de ser reta.
		expect(valores.size).toBeGreaterThan(1);
		expect(points.length).toBeGreaterThan(300);
	});
});
