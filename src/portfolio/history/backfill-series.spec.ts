import { backfillSeries, PriceLookup } from './backfill-series';

const prices = (
	entries: Record<string, Record<string, number>>
): PriceLookup => {
	const lookup: PriceLookup = new Map();
	for (const [symbol, byDay] of Object.entries(entries)) {
		lookup.set(symbol, new Map(Object.entries(byDay)));
	}
	return lookup;
};

describe('backfillSeries', () => {
	// O ganho sobre history-from-trades: entre duas negociacoes a curva se move
	// com o mercado, em vez de ficar achatada no ultimo preco negociado.
	it('valoriza ao fechamento real de cada dia, nao ao ultimo negociado', () => {
		const result = backfillSeries({
			trades: [
				{
					symbol: 'PETR4',
					side: 'buy',
					quantity: 100,
					price: 30,
					date: '2025-06-10',
				},
			],
			prices: prices({
				PETR4: {
					'2025-06-10': 30,
					'2025-06-11': 33,
					'2025-06-12': 31,
				},
			}),
			until: '2025-06-12',
		});

		expect(result.covered).toBe(true);
		expect(result.points.map((p) => p.totalValue)).toEqual([3000, 3300, 3100]);
		// Custo nao se move com o mercado.
		expect(result.points.map((p) => p.investedValue)).toEqual([
			3000, 3000, 3000,
		]);
	});

	it('marca o ponto e o simbolo quando falta cotacao no dia', () => {
		const result = backfillSeries({
			trades: [
				{
					symbol: 'PETR4',
					side: 'buy',
					quantity: 100,
					price: 30,
					date: '2025-06-10',
				},
			],
			prices: prices({ PETR4: { '2025-06-10': 30, '2025-06-12': 31 } }),
			until: '2025-06-12',
		});

		const [d10, d11, d12] = result.points;
		expect(d10.stale).toBe(false);
		// 11/06 sem cotacao: carrega a ultima conhecida, mas avisa.
		expect(d11.stale).toBe(true);
		expect(d11.staleSymbols).toEqual(['PETR4']);
		expect(d11.totalValue).toBe(3000);
		expect(d12.stale).toBe(false);
	});

	it('marca fim de semana e feriado como dia sem pregao', () => {
		const result = backfillSeries({
			trades: [
				{
					symbol: 'PETR4',
					side: 'buy',
					quantity: 10,
					price: 30,
					date: '2025-06-06',
				},
			],
			prices: prices({ PETR4: { '2025-06-06': 30 } }),
			until: '2025-06-09',
		});

		const byDate = new Map(result.points.map((p) => [p.date, p]));
		expect(byDate.get('2025-06-06')?.tradingDay).toBe(true); // sexta
		expect(byDate.get('2025-06-07')?.nonTradingReason).toBe('weekend');
		expect(byDate.get('2025-06-08')?.nonTradingReason).toBe('weekend');
		expect(byDate.get('2025-06-09')?.tradingDay).toBe(true); // segunda
	});

	it('reduz o custo pelo preco medio na venda, nao pelo preco de venda', () => {
		const result = backfillSeries({
			trades: [
				{
					symbol: 'PETR4',
					side: 'buy',
					quantity: 100,
					price: 30,
					date: '2025-06-10',
				},
				{
					symbol: 'PETR4',
					side: 'sell',
					quantity: 50,
					price: 50,
					date: '2025-06-11',
				},
			],
			prices: prices({ PETR4: { '2025-06-10': 30, '2025-06-11': 50 } }),
			until: '2025-06-11',
		});

		const [, afterSale] = result.points;
		// Sobram 50 cotas a custo medio 30 = 1500 de custo, valendo 50 cada.
		expect(afterSale.investedValue).toBe(1500);
		expect(afterSale.totalValue).toBe(2500);
	});

	it('nao deixa posicao negativa quando a venda excede o historico', () => {
		const result = backfillSeries({
			trades: [
				{
					symbol: 'PETR4',
					side: 'buy',
					quantity: 10,
					price: 30,
					date: '2025-06-10',
				},
				{
					symbol: 'PETR4',
					side: 'sell',
					quantity: 50,
					price: 40,
					date: '2025-06-11',
				},
			],
			prices: prices({ PETR4: { '2025-06-10': 30, '2025-06-11': 40 } }),
			until: '2025-06-11',
		});

		const [, afterSale] = result.points;
		expect(afterSale.totalValue).toBe(0);
		expect(afterSale.investedValue).toBe(0);
	});

	it('soma varios simbolos no mesmo dia', () => {
		const result = backfillSeries({
			trades: [
				{
					symbol: 'PETR4',
					side: 'buy',
					quantity: 100,
					price: 30,
					date: '2025-06-10',
				},
				{
					symbol: 'VALE3',
					side: 'buy',
					quantity: 10,
					price: 60,
					date: '2025-06-10',
				},
			],
			prices: prices({
				PETR4: { '2025-06-10': 32 },
				VALE3: { '2025-06-10': 65 },
			}),
			until: '2025-06-10',
		});

		expect(result.points[0].totalValue).toBe(3200 + 650);
		expect(result.points[0].investedValue).toBe(3000 + 600);
	});

	// Carteira manual sem nota importada: projetar a posicao de hoje para tras
	// seria ficcao, do mesmo tipo que motivou remover o preco-alvo (TRA-55).
	it('recusa reconstruir sem negociacao, em vez de inventar posicao', () => {
		const result = backfillSeries({
			trades: [],
			prices: prices({}),
			until: '2025-06-10',
		});

		expect(result.covered).toBe(false);
		expect(result.points).toEqual([]);
	});

	it('valoriza pelo custo medio quando o simbolo nunca teve cotacao', () => {
		const result = backfillSeries({
			trades: [
				{
					symbol: 'XPTO11',
					side: 'buy',
					quantity: 10,
					price: 100,
					date: '2025-06-10',
				},
			],
			prices: prices({}),
			until: '2025-06-10',
		});

		expect(result.points[0].totalValue).toBe(1000);
		expect(result.points[0].stale).toBe(true);
		expect(result.points[0].staleSymbols).toEqual(['XPTO11']);
	});
});
