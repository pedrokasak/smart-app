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

	it('marca pagamento extraordinário entre vários pagamentos', () => {
		const facts = analyzeDividendIncome(
			[
				{
					symbol: 'BBSE3',
					quantity: 100,
					price: 30,
					currentPrice: 32,
					dividendHistory: [
						{ date: daysAgo(30), value: 6 },
						{ date: daysAgo(120), value: 1 },
						{ date: daysAgo(210), value: 1 },
						{ date: daysAgo(300), value: 1 },
					],
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
	});

	it('posição mais nova que 12 meses deixa o total aproximado', () => {
		const facts = analyzeDividendIncome(
			[{ ...MXRF11, createdAt: daysAgo(90) }],
			null,
			NOW
		);
		expect(facts.approximated).toBe(true);
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
