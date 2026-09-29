import { periodFromReference } from 'src/ri-intelligence/domain/ri-document-period';

describe('periodFromReference (TRA-260)', () => {
	it('uses the reference date when it has year and month', () => {
		expect(periodFromReference('2025-03-31', '')).toBe('03T25');
	});

	it('falls back to the year alone', () => {
		expect(periodFromReference('Exercício 2025', '')).toBe('2025');
	});

	it('falls back to a quarter code in the title', () => {
		expect(periodFromReference('', 'Release de Resultados 2t26')).toBe('2T26');
	});

	it('has no period when nothing identifies one', () => {
		expect(periodFromReference(null, 'Fato Relevante')).toBeNull();
	});
});
