import { validateDigestNarrative } from './digest-narrative-validator';
import { PortfolioDigestFacts } from 'src/notifications/portfolio-digest/domain/portfolio-digest.types';

function facts(
	overrides: Partial<PortfolioDigestFacts> = {}
): PortfolioDigestFacts {
	return {
		periodStart: '2026-08-11',
		periodEnd: '2026-08-18',
		portfolioValue: 10000,
		periodChangePct: 5,
		periodChangeAbs: 500,
		topGainers: [{ symbol: 'PETR4', changePercent: 3 }],
		topLosers: [{ symbol: 'VALE3', changePercent: -2 }],
		watchItems: [
			{
				symbol: 'ITUB4',
				reason: 'concentration_above_threshold',
				detail: 'ITUB4 representa 40% da carteira.',
			},
		],
		dividendsReceived: 100,
		hasSufficientData: true,
		...overrides,
	};
}

describe('validateDigestNarrative', () => {
	it('aceita narrativa que so cita tickers presentes nos fatos', () => {
		const result = validateDigestNarrative(
			'Sua carteira subiu essa semana, puxada por PETR4. VALE3 recuou um pouco, e ITUB4 segue concentrado.',
			facts()
		);

		expect(result.valid).toBe(true);
	});

	it('rejeita narrativa vazia', () => {
		expect(validateDigestNarrative('', facts())).toEqual({
			valid: false,
			reason: 'empty',
		});
		expect(validateDigestNarrative('   ', facts())).toEqual({
			valid: false,
			reason: 'empty',
		});
	});

	it('rejeita narrativa longa demais', () => {
		const result = validateDigestNarrative('x'.repeat(601), facts());
		expect(result).toEqual({ valid: false, reason: 'too_long' });
	});

	it('rejeita ticker que nao esta nos fatos — o caso que importa de verdade', () => {
		const result = validateDigestNarrative(
			'Considere observar WEGE3 essa semana.',
			facts()
		);

		expect(result).toEqual({ valid: false, reason: 'unknown_ticker' });
	});

	it.each([
		'Recomendo vender PETR4.',
		'Compre mais VALE3 agora.',
		'Considere investir em ITUB4.',
		'Recomendamos cautela com PETR4.',
	])('rejeita linguagem de recomendacao: "%s"', (text) => {
		const result = validateDigestNarrative(text, facts());
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('recommendation_language');
	});

	it('nao falso-positiva em "aporte" (termo legitimo do produto)', () => {
		const result = validateDigestNarrative(
			'Seu aporte mensal seguiu normal essa semana, com PETR4 em destaque.',
			facts()
		);

		expect(result.valid).toBe(true);
	});

	it('aceita narrativa sem nenhum ticker mencionado', () => {
		const result = validateDigestNarrative(
			'Sua carteira teve uma semana estável, sem grandes movimentos.',
			facts()
		);

		expect(result.valid).toBe(true);
	});
});
