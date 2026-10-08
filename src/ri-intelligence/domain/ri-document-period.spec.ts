import { periodFromReference } from 'src/ri-intelligence/domain/ri-document-period';

describe('periodFromReference (TRA-260, TRA-277)', () => {
	// O caso do print: release do 2T26 do ABCB4 aparecia como "06T26".
	it.each([
		['2026-03-31', '1T26'],
		['2026-06-30', '2T26'],
		['2025-09-30', '3T25'],
		['2025-12-31', '4T25'],
	])('turns the quarter-end reference %s into %s', (reference, period) => {
		expect(periodFromReference(reference, 'Press-release')).toBe(period);
	});

	// Ata, aviso e posicao mensal: a data e do evento, nao de um periodo.
	it('has no period for a reference date that is not a quarter end', () => {
		expect(periodFromReference('2026-06-01', 'Posição Consolidada')).toBeNull();
		expect(
			periodFromReference('2026-04-30', 'Assembleia - AGO/E - Ata')
		).toBeNull();
	});

	it('prefers the quarter written in the title', () => {
		expect(
			periodFromReference(
				'2026-08-14',
				'Demonstrações Financeiras Adicionais - Informações Financeiras Trimestrais 2T26 - Inglês'
			)
		).toBe('2T26');
	});

	it('does not read a quarter out of a longer number', () => {
		expect(periodFromReference('2026-06-30', 'Protocolo 020958IPE12T260')).toBe(
			'2T26'
		);
		expect(periodFromReference(null, 'Protocolo 12T260')).toBeNull();
	});

	it('falls back to the year alone', () => {
		expect(periodFromReference('Exercício 2025', '')).toBe('2025');
	});

	it('reads a quarter code in the title without a reference', () => {
		expect(periodFromReference('', 'Release de Resultados 2t26')).toBe('2T26');
	});

	it('has no period when nothing identifies one', () => {
		expect(periodFromReference(null, 'Fato Relevante')).toBeNull();
	});
});
