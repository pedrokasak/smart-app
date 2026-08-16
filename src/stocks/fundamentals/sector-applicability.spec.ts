import { isApplicable, normalizeSector } from './sector-applicability';

describe('isApplicable', () => {
	it.each(['roic', 'netMargin', 'netDebt'] as const)(
		'marca %s como nao aplicavel para banco',
		(key) => {
			expect(isApplicable('Intermediários Financeiros', key)).toBe(false);
		},
	);

	it.each(['payout', 'priceEarnings', 'priceToBook', 'returnOnEquity'] as const)(
		'mantem %s aplicavel para banco',
		(key) => {
			expect(isApplicable('Intermediários Financeiros', key)).toBe(true);
		},
	);

	it('mantem tudo aplicavel para setor nao financeiro', () => {
		expect(isApplicable('Máquinas e Equipamentos', 'roic')).toBe(true);
		expect(isApplicable('Máquinas e Equipamentos', 'netMargin')).toBe(true);
	});

	it('trata setor desconhecido como aplicavel', () => {
		expect(isApplicable(null, 'roic')).toBe(true);
		expect(isApplicable('', 'roic')).toBe(true);
	});

	it('reconhece o setor sem acento e com caixa diferente', () => {
		expect(isApplicable('INTERMEDIARIOS FINANCEIROS', 'roic')).toBe(false);
		expect(isApplicable('  intermediários   financeiros ', 'roic')).toBe(false);
	});
});

describe('normalizeSector', () => {
	it('remove acento, colapsa espaco e sobe caixa', () => {
		expect(normalizeSector(' Intermediários  Financeiros ')).toBe(
			'INTERMEDIARIOS FINANCEIROS',
		);
	});

	it('devolve null para vazio', () => {
		expect(normalizeSector('')).toBeNull();
		expect(normalizeSector(null)).toBeNull();
	});
});
