import {
	type DividendAsset,
	analyzeDividendIncome,
	monthsToTarget,
} from './dividend-income';

const NOW = Date.UTC(2026, 9, 14);
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000);

const monthly = (value: number, count = 12): DividendAsset['dividendHistory'] =>
	Array.from({ length: count }, (_, index) => ({
		date: daysAgo(15 + index * 30),
		value,
	}));

const TAEE11: DividendAsset = {
	symbol: 'TAEE11',
	quantity: 100,
	price: 30,
	currentPrice: 36,
	dividendHistory: [
		{ date: daysAgo(40), value: 1.2 },
		{ date: daysAgo(130), value: 0.9 },
		{ date: daysAgo(220), value: 1.1 },
		{ date: daysAgo(310), value: 0.8 },
		// Fora da janela de 12 meses.
		{ date: daysAgo(400), value: 5 },
	],
};

const MXRF11: DividendAsset = {
	symbol: 'MXRF11',
	quantity: 1000,
	price: 10,
	currentPrice: 10,
	dividendHistory: monthly(0.1),
};

describe('analyzeDividendIncome', () => {
	it('soma 12 meses por ativo, yield sobre mercado e custo e maiores pagadores', () => {
		const facts = analyzeDividendIncome([TAEE11, MXRF11], null, NOW);

		// TAEE11: 4,00 × 100 = 400; MXRF11: 1,20 × 1000 = 1200.
		expect(facts.total12m).toBe(1600);
		expect(facts.monthlyAvg).toBeCloseTo(133.33, 2);
		expect(facts.portfolioValue).toBe(13600);
		expect(facts.yieldOnMarketPct).toBeCloseTo(11.76, 2);
		expect(facts.yieldOnCostPct).toBeCloseTo(12.31, 2);
		expect(facts.payers).toEqual([
			{ symbol: 'MXRF11', amount: 1200, sharePct: 75 },
			{ symbol: 'TAEE11', amount: 400, sharePct: 25 },
		]);
		expect(facts.traps).toEqual([]);
		expect(facts.goal).toBeNull();
	});

	it('junta o mesmo ativo em carteiras diferentes sem contar o provento duas vezes por ação', () => {
		const facts = analyzeDividendIncome(
			[MXRF11, { ...MXRF11, quantity: 500 }],
			null,
			NOW
		);
		expect(facts.payers).toEqual([
			{ symbol: 'MXRF11', amount: 1800, sharePct: 100 },
		]);
	});

	it('projeta a renda mensal reinvestindo ao yield de mercado', () => {
		const facts = analyzeDividendIncome([MXRF11], null, NOW);

		// 100/mês e yield 12%: 100 × 1,12^5 e 100 × 1,12^10.
		expect(facts.projection).toEqual([
			{ years: 5, monthlyIncome: 176.23 },
			{ years: 10, monthlyIncome: 310.58 },
		]);
	});

	it('marca yield inflado por queda de preço', () => {
		const facts = analyzeDividendIncome(
			[{ ...TAEE11, symbol: 'XPTO3', price: 60, currentPrice: 36 }],
			null,
			NOW
		);
		expect(facts.traps).toEqual([
			{
				symbol: 'XPTO3',
				kind: 'price_drop',
				yieldOnMarketPct: 11.11,
				priceChangePct: -40,
				largestPayoutSharePct: null,
			},
		]);
	});

	const bigPayoutHistory = (previousLargest: number) => [
		{ date: daysAgo(30), value: 6 },
		{ date: daysAgo(120), value: 1 },
		{ date: daysAgo(210), value: 1 },
		{ date: daysAgo(300), value: 1 },
		// Ano anterior.
		{ date: daysAgo(400), value: previousLargest },
		{ date: daysAgo(490), value: 1 },
	];

	it('marca pagamento extraordinário e o tira da projeção', () => {
		const facts = analyzeDividendIncome(
			[
				{
					symbol: 'BBSE3',
					quantity: 100,
					price: 30,
					currentPrice: 32,
					dividendHistory: bigPayoutHistory(1),
				},
			],
			null,
			NOW
		);
		expect(facts.traps[0]).toMatchObject({
			symbol: 'BBSE3',
			kind: 'extraordinary',
			largestPayoutSharePct: 66.67,
		});
		// Base recorrente: 3 × 1 × 100 = 300/ano (25/mês), yield 300/3200.
		expect(facts.projectionExcludesOneOff).toBe(true);
		expect(facts.projection[0].monthlyIncome).toBeCloseTo(
			25 * (1 + 300 / 3200) ** 5,
			2
		);
	});

	it('pagamento grande que já veio no ano anterior é o dividendo anual, não extraordinário', () => {
		const facts = analyzeDividendIncome(
			[
				{
					symbol: 'BBSE3',
					quantity: 100,
					price: 30,
					currentPrice: 32,
					dividendHistory: bigPayoutHistory(5.5),
				},
			],
			null,
			NOW
		);
		expect(facts.traps).toEqual([]);
		expect(facts.projectionExcludesOneOff).toBe(false);
	});

	it('posição mais nova que 12 meses deixa o total aproximado', () => {
		const facts = analyzeDividendIncome(
			[{ ...MXRF11, createdAt: daysAgo(90) }],
			null,
			NOW
		);
		expect(facts.approximated).toBe(true);
	});

	it('meta do plano usa o patrimônio inteiro quando informado', () => {
		const plan = {
			expectedRealReturnPct: 6,
			monthlyContribution: 0,
			goal: { title: 'Independência', targetAmount: 50_000 },
		};
		const onlyThis = analyzeDividendIncome([MXRF11], plan, NOW);
		const whole = analyzeDividendIncome(
			[MXRF11],
			{ ...plan, patrimony: 60_000 },
			NOW
		);

		expect(onlyThis.goal?.monthsReinvesting).toBeGreaterThan(0);
		expect(whole.goal?.monthsReinvesting).toBe(0);
	});

	it('meta do plano: reinvestir chega antes de gastar os proventos', () => {
		const facts = analyzeDividendIncome(
			[MXRF11],
			{
				expectedRealReturnPct: 6,
				monthlyContribution: 1000,
				goal: { title: 'Independência', targetAmount: 200_000 },
			},
			NOW
		);

		expect(facts.goal?.title).toBe('Independência');
		expect(facts.goal?.monthsReinvesting).toBeGreaterThan(0);
		expect(facts.goal!.monthsSpending!).toBeGreaterThan(
			facts.goal!.monthsReinvesting!
		);
	});

	it('sem provento nenhum, total zero e sem projeção', () => {
		const facts = analyzeDividendIncome(
			[{ symbol: 'BTC', quantity: 1, price: 100, currentPrice: 120 }],
			null,
			NOW
		);
		expect(facts.total12m).toBe(0);
		expect(facts.projection).toEqual([]);
		expect(facts.payers).toEqual([]);
	});
});

describe('monthsToTarget', () => {
	it('conta os meses até a meta e devolve null quando não chega em 100 anos', () => {
		expect(monthsToTarget(1000, 0, 0, 500)).toBe(0);
		expect(monthsToTarget(0, 100, 0, 1200)).toBe(12);
		expect(monthsToTarget(0, 0, 0, 1000)).toBeNull();
	});
});
