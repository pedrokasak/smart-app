import type { DidacticLevel } from 'src/ai/didactic/didactic.types';
import type { DividendIncomeFacts } from '../domain/dividend-income';
import { explainDividendIncome } from './dividend-income-didactic';

const LEVELS: DidacticLevel[] = ['iniciante', 'intermediario', 'avancado'];

const facts = (
	overrides: Partial<DividendIncomeFacts> = {}
): DividendIncomeFacts => ({
	total12m: 6000,
	monthlyAvg: 500,
	portfolioValue: 100_000,
	yieldOnMarketPct: 6,
	yieldOnCostPct: 8,
	approximated: false,
	payers: [
		{ symbol: 'TAEE11', amount: 3000, sharePct: 50 },
		{ symbol: 'BBAS3', amount: 1800, sharePct: 30 },
	],
	projection: [
		{ years: 5, monthlyIncome: 669.11 },
		{ years: 10, monthlyIncome: 895.42 },
	],
	traps: [],
	goal: null,
	...overrides,
});

const all = (answer: NonNullable<ReturnType<typeof explainDividendIncome>>) =>
	[
		answer.answer,
		answer.meaning,
		answer.whyItMatters,
		...answer.options,
		...answer.terms.map((term) => term.definition),
	]
		.filter(Boolean)
		.join(' ');

describe('explainDividendIncome', () => {
	it.each(LEVELS)('%s: pt-BR numbers and no buy/sell order', (level) => {
		const text = all(explainDividendIncome(facts(), level)!);

		expect(text).not.toMatch(/\d\.\d+%/);
		expect(text).not.toMatch(
			/\b(undefined|NaN|null|price_drop|extraordinary)\b/
		);
		expect(text).not.toMatch(
			/\b(compre|venda|recomendamos|você deve|priorize)\b/i
		);
	});

	it('beginner: income per month, how reinvesting grows it, concentration', () => {
		const answer = explainDividendIncome(facts(), 'iniciante')!;

		expect(answer.answer).toMatch(
			/cerca de R\$\s6\.000 em proventos, uns R\$\s500 por mês\.$/
		);
		expect(answer.meaning).toContain('6% do que sua carteira vale por ano');
		expect(answer.whyItMatters).toMatch(
			/R\$\s669 em 5 anos e R\$\s895 em 10 anos, em reais de hoje/
		);
		expect(answer.options[0]).toContain('Reinvestir os proventos');
		expect(answer.options[2]).toContain('TAEE11 responde por 50%');
		expect(answer.terms.map((term) => term.term)).toContain('Reinvestimento');
	});

	it('explains the plan goal with and without reinvesting', () => {
		const answer = explainDividendIncome(
			facts({
				goal: {
					title: 'Independência',
					targetAmount: 1_000_000,
					monthsReinvesting: 150,
					monthsSpending: 222,
				},
			}),
			'iniciante'
		)!;

		expect(answer.whyItMatters).toContain(
			'reinvestindo os proventos você chega em 12 anos e 6 meses; gastando os proventos, em 18 anos e 6 meses. São 6 anos de diferença.'
		);
	});

	it('warns about yields inflated by price drops and one-off payments', () => {
		const answer = explainDividendIncome(
			facts({
				traps: [
					{
						symbol: 'XPTO3',
						kind: 'price_drop',
						yieldOnMarketPct: 14.5,
						priceChangePct: -38,
						largestPayoutSharePct: null,
					},
					{
						symbol: 'BBSE3',
						kind: 'extraordinary',
						yieldOnMarketPct: 9,
						priceChangePct: null,
						largestPayoutSharePct: 66.67,
					},
				],
			}),
			'intermediario'
		)!;

		expect(answer.whyItMatters).toContain(
			'Atenção: XPTO3 paga 14,5% ao ano sobre o preço de hoje, mas o preço caiu 38%'
		);
		expect(answer.whyItMatters).toContain('BBSE3, um único pagamento foi 67%');
	});

	it('advanced is short and technical', () => {
		const answer = explainDividendIncome(facts(), 'avancado')!;

		expect(answer.answer).toBe(
			'R$ 6.000 em 12m; DY 6%, YoC 8%; maior pagador TAEE11 (50%).'
		);
		expect(answer.options[0]).toBe(
			'Reinvestimento dos proventos: renda cresce à taxa do DY.'
		);
	});

	it('no income, no block', () => {
		expect(
			explainDividendIncome(facts({ total12m: 0 }), 'iniciante')
		).toBeNull();
	});
});
