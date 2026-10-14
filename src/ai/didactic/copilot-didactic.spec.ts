import { DEFAULT_INVESTMENT_POLICY } from 'src/investment-policy/domain/investment-policy';
import {
	composeDidactic,
	hasDidacticComposer,
	renderDidactic,
	type DidacticContext,
	type DidacticInput,
} from './copilot-didactic';
import type { DidacticAnswer, DidacticLevel } from './didactic.types';
import { didacticLevelFrom } from './didactic.types';

const LEVELS: DidacticLevel[] = ['iniciante', 'intermediario', 'avancado'];

const ctx = (
	level: DidacticLevel,
	overrides: Partial<DidacticContext> = {}
): DidacticContext => ({
	level,
	policy: { ...DEFAULT_INVESTMENT_POLICY, maxAssetWeightPct: 10 },
	policyIsDefault: false,
	...overrides,
});

const risk: DidacticInput = {
	intent: 'portfolio_risk',
	question: 'Qual o risco da minha carteira?',
	data: {
		portfolioRisk: {
			risk: {
				score: 68,
				level: 'high',
				flags: [{ code: 'ASSET_CONCENTRATION_HIGH' }, { code: 'BETA_HIGH' }],
			},
			concentrationByAsset: [
				{ key: 'PETR4', percentage: 22, value: 22000 },
				{ key: 'ITUB4', percentage: 12, value: 12000 },
			],
			concentrationBySector: [
				{ key: 'UNKNOWN', percentage: 40 },
				{ key: 'Energia', percentage: 30 },
			],
		},
	},
};

const dividends: DidacticInput = {
	intent: 'dividends_received',
	question: 'Quanto recebi de proventos?',
	data: {
		dividendsReceived: {
			total12m: 6000,
			yieldOnMarket: 0.06,
			yieldOnCost: 0.08,
			approximated: false,
			topPayers: [
				{ symbol: 'TAEE11', amount: 3000 },
				{ symbol: 'BBAS3', amount: 1800 },
			],
		},
	},
};

const gap: DidacticInput = {
	intent: 'allocation_gap',
	question: 'Onde minha carteira está fora da meta?',
	data: {
		rebalancing: {
			hasTarget: true,
			totalDriftPct: 24.4,
			buckets: [
				{
					bucket: 'stocks',
					currentPct: 62,
					targetPct: 50,
					gapPct: -12,
					amount: 12000,
				},
				{
					bucket: 'fund',
					currentPct: 18,
					targetPct: 30,
					gapPct: 12,
					amount: 12000,
				},
				{
					bucket: 'fiis',
					currentPct: 20,
					targetPct: 20,
					gapPct: 0.4,
					amount: 400,
				},
			],
		},
	},
};

const sell: DidacticInput = {
	intent: 'sell_simulation',
	question: 'Se eu vender PETR4?',
	data: {
		sellSimulation: {
			symbol: 'PETR4',
			assetType: 'stock',
			averagePrice: 30,
			realizedPnl: 5000,
			estimatedTax: 750,
			taxRateApplied: 0.15,
			monthlyExemptionApplied: false,
		},
	},
};

const summary: DidacticInput = {
	intent: 'portfolio_summary',
	question: 'Resumo da minha carteira',
	data: {
		portfolioSummary: {
			totalValue: 100000,
			positionsCount: 8,
			allocationByClass: [
				{ key: 'stocks', percentage: 60 },
				{ key: 'fiis', percentage: 40 },
			],
			diversification: {
				score: 64,
				status: 'moderate',
				components: { assetSpread: 70, classSpread: 50, sectorSpread: 60 },
			},
		},
	},
};

const ALL = [risk, dividends, gap, sell, summary];

const fullText = (answer: DidacticAnswer) =>
	[
		answer.answer,
		answer.meaning,
		answer.whyItMatters,
		...answer.options,
		...answer.terms.map((term) => `${term.term} ${term.definition}`),
	]
		.filter(Boolean)
		.join(' ');

describe('copilot didactic composers', () => {
	describe.each(ALL)('$intent', (input) => {
		it.each(LEVELS)('answers at level %s without internal keys', (level) => {
			const answer = composeDidactic(input, ctx(level));

			expect(answer).not.toBeNull();
			expect(answer!.level).toBe(level);
			expect(answer!.answer.length).toBeGreaterThan(10);
			const text = fullText(answer!);
			// Nada de chave interna nem número em formato americano.
			expect(text).not.toMatch(
				/\b(stocks|fiis|fund|crypto|UNKNOWN|undefined|null|NaN)\b/
			);
			expect(text).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
			expect(text).not.toMatch(/\d\.\d+%/);
			expect(answer!.followUps.length).toBeLessThanOrEqual(3);
		});

		it('never tells the person what to buy or sell', () => {
			for (const level of LEVELS) {
				const text = fullText(composeDidactic(input, ctx(level))!);
				expect(text).not.toMatch(
					/\b(recomendamos|recomendo|você deve|compre|venda já|sugerimos)\b/i
				);
			}
		});
	});

	it('beginner risk explains with an analogy and the loss in reais', () => {
		const answer = composeDidactic(risk, ctx('iniciante'))!;

		expect(answer.answer).toContain('PETR4');
		expect(answer.answer).toContain('22%');
		expect(answer.meaning).toContain('cesta');
		// 20% de R$ 22.000.
		expect(answer.whyItMatters).toContain('R$ 4.400');
		expect(answer.whyItMatters).toContain(
			'limite que você definiu na sua política é 10%'
		);
		expect(answer.terms.map((term) => term.term)).toEqual([
			'Concentração',
			'Política de investimento',
		]);
		expect(answer.options).toHaveLength(3);
	});

	it('advanced risk is technical and lists the active flags', () => {
		const answer = composeDidactic(risk, ctx('avancado'))!;

		expect(answer.answer).toBe(
			'Score de risco 68/100 (alto); maior posição PETR4 com 22%, maior setor Energia com 30%; 12 p.p. acima do limite da política (10%).'
		);
		expect(answer.meaning).toBe(
			'Sinais ativos: concentração alta em ativo, beta alto.'
		);
		expect(answer.meaning).not.toContain('cesta');
	});

	it('names the Trackerr default limit when the person has no policy yet', () => {
		const answer = composeDidactic(
			risk,
			ctx('intermediario', {
				policy: DEFAULT_INVESTMENT_POLICY,
				policyIsDefault: true,
			})
		)!;

		expect(answer.answer).toContain('acima do limite padrão do Trackerr (8%)');
		expect(answer.options[2]).toContain('Definir o seu próprio limite');
	});

	it('risk without the policy skips the limit and the options', () => {
		const answer = composeDidactic(
			risk,
			ctx('intermediario', { policy: null })
		)!;

		expect(answer.answer).not.toContain('limite');
		expect(answer.options).toEqual([]);
	});

	it('dividends explain how to grow the income and flag concentration', () => {
		const answer = composeDidactic(dividends, ctx('iniciante'))!;

		expect(answer.answer).toContain('R$ 6.000');
		expect(answer.answer).toContain('R$ 500 por mês');
		expect(answer.whyItMatters).toContain('bola de neve');
		expect(answer.options.join(' ')).toContain('Reinvestir');
		// TAEE11 paga 50% da renda.
		expect(answer.options.join(' ')).toContain('TAEE11 paga 50%');
	});

	it('intermediate dividends read yield on cost against market yield', () => {
		const answer = composeDidactic(dividends, ctx('intermediario'))!;

		expect(answer.answer).toContain('yield de 6% sobre o valor de mercado');
		expect(answer.answer).toContain('8% sobre o seu custo');
		expect(answer.meaning).toContain('valorizaram desde a compra');
	});

	it('allocation gap ignores sub-1 p.p. drifts and offers contributions first', () => {
		const answer = composeDidactic(gap, ctx('intermediario'))!;

		// Soma dos gaps 24,4 p.p.: metade da carteira desse total está fora do lugar.
		expect(answer.answer).toContain('12,2% da carteira está fora da meta');
		expect(answer.meaning).toContain('Ações: +12 p.p. (acima');
		expect(answer.meaning).toContain('Renda fixa: -12 p.p. (abaixo');
		expect(answer.meaning).not.toContain('FIIs');
		expect(answer.options[0]).toContain('Renda fixa');
		expect(answer.followUps[0]).toBe('Simular aporte de R$ 12.000');
	});

	it('allocation gap without a target explains what a target is', () => {
		const answer = composeDidactic(
			{ ...gap, data: { rebalancing: { hasTarget: false } } },
			ctx('iniciante')
		)!;

		expect(answer.answer).toContain('ainda não definiu uma meta');
		expect(answer.meaning).toContain('Configurações');
	});

	it('sell explains that tax is on the profit, not on the sale', () => {
		const answer = composeDidactic(sell, ctx('iniciante'))!;

		expect(answer.answer).toBe(
			'Vendendo PETR4, o lucro seria de cerca de R$ 5.000, com R$ 750 de imposto.'
		);
		expect(answer.meaning).toContain('só sobre o lucro');
		expect(answer.options[0]).toContain('R$ 20 mil no mês');
	});

	it('sell at a loss shows the compensable loss', () => {
		const answer = composeDidactic(
			{
				...sell,
				data: {
					sellSimulation: {
						...sell.data.sellSimulation,
						realizedPnl: -1200,
						estimatedTax: 0,
					},
				},
			},
			ctx('iniciante')
		)!;

		expect(answer.answer).toContain('prejuízo de cerca de R$ 1.200');
		expect(answer.terms.map((term) => term.term)).toContain(
			'Prejuízo compensável'
		);
	});

	it.each([
		'Quais ativos eu tenho?',
		'Liste meus ativos',
		'Mostre os ativos da minha carteira',
	])('summary keeps the classic list for "%s"', (question) => {
		expect(
			composeDidactic({ ...summary, question }, ctx('iniciante'))
		).toBeNull();
	});

	it('sell explains the loss compensation the tax engine applied', () => {
		const compensated = {
			...sell,
			data: {
				sellSimulation: {
					...sell.data.sellSimulation,
					estimatedTax: 300,
					compensationUsed: 3000,
					taxableBaseAfterCompensation: 2000,
				},
			},
		};
		const beginner = composeDidactic(compensated, ctx('iniciante'))!;
		const intermediate = composeDidactic(compensated, ctx('intermediario'))!;

		expect(beginner.whyItMatters).toContain(
			'de prejuízo de vendas anteriores abatem esse lucro'
		);
		expect(beginner.whyItMatters).toContain(
			'já considera as outras vendas do mês'
		);
		expect(beginner.whyItMatters).not.toContain('não considera');
		expect(intermediate.meaning).toContain('base tributável de R$');
		expect(intermediate.meaning).toMatch(/2\.000/);
		expect(beginner.terms.map((term) => term.term)).toContain(
			'Prejuízo compensável'
		);
	});

	it('equal yields do not claim the assets fell', () => {
		const answer = composeDidactic(
			{
				...dividends,
				data: {
					dividendsReceived: {
						...dividends.data.dividendsReceived,
						yieldOnCost: 0.0602,
						yieldOnMarket: 0.06,
					},
				},
			},
			ctx('intermediario')
		)!;

		expect(answer.meaning).toContain('estão próximos');
		expect(answer.meaning).not.toContain('desvalorizaram');
	});

	it('contribution follow-up never rounds to R$ 0', () => {
		const answer = composeDidactic(
			{
				...gap,
				data: {
					rebalancing: {
						hasTarget: true,
						totalDriftPct: 3,
						buckets: [
							{
								bucket: 'stocks',
								currentPct: 51.5,
								targetPct: 50,
								gapPct: -1.5,
								amount: -45,
							},
							{
								bucket: 'fund',
								currentPct: 28.5,
								targetPct: 30,
								gapPct: 1.5,
								amount: 45,
							},
						],
					},
				},
			},
			ctx('iniciante')
		)!;

		expect(answer.followUps[0]).toMatch(/^Simular aporte de R\$\s100$/);
	});

	it('returns null for intents without composer or without data', () => {
		expect(
			composeDidactic(
				{ intent: 'ri_question', question: '', data: {} },
				ctx('iniciante')
			)
		).toBeNull();
		expect(composeDidactic({ ...risk, data: {} }, ctx('iniciante'))).toBeNull();
		expect(hasDidacticComposer('ri_question')).toBe(false);
		expect(hasDidacticComposer('portfolio_risk')).toBe(true);
	});

	it('renders the bubble text with the level-specific heading', () => {
		const beginner = renderDidactic(composeDidactic(risk, ctx('iniciante'))!);
		const advanced = renderDidactic(composeDidactic(risk, ctx('avancado'))!);

		expect(beginner).toContain('O que isso significa:');
		expect(beginner).toContain('Por que importa:');
		expect(beginner).toContain('• Colocar os próximos aportes');
		expect(beginner).toContain('A decisão é sua');
		expect(advanced).toContain('Leitura:');
		expect(advanced).not.toContain('O que isso significa:');
	});
});

describe('didacticLevelFrom', () => {
	it('maps the investor profile and defaults to intermediate', () => {
		expect(didacticLevelFrom('beginner')).toBe('iniciante');
		expect(didacticLevelFrom('experienced')).toBe('avancado');
		expect(didacticLevelFrom(null)).toBe('intermediario');
	});
});
