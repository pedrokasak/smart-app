import {
	classifyRiDocumentType,
	normalizeRiDocumentType,
} from 'src/ri-intelligence/domain/ri-document-classifier';

describe('ri-document-classifier', () => {
	it('classifies earnings release from title and file/url patterns', () => {
		const result = classifyRiDocumentType({
			title: 'Release de Resultados 4T25',
			fileName: 'release-resultados-4t25.pdf',
			url: 'https://ri.empresa.com.br/resultados/release-4t25.pdf',
		});

		expect(result.documentType).toBe('earnings_release');
		expect(result.confidence).toMatch(/high|medium/);
		expect(result.score).toBeGreaterThan(0.45);
	});

	it('classifies investor presentation from subtitle and metadata aliases', () => {
		const result = classifyRiDocumentType({
			title: 'Apresentacao Institucional',
			subtitle: 'Investor Presentation 2026',
			metadata: { category: 'presentation' },
		});

		expect(result.documentType).toBe('investor_presentation');
		expect(result.confidence).toBe('high');
		expect(result.score).toBeGreaterThan(0.9);
	});

	it('classifies material fact deterministically', () => {
		const result = classifyRiDocumentType({
			title: 'Fato Relevante',
			url: 'https://ri.empresa.com.br/fato-relevante-operacao.pdf',
		});

		expect(result.documentType).toBe('material_fact');
		expect(result.confidence).toMatch(/high|medium/);
		expect(result.score).toBeGreaterThan(0.4);
	});

	it('handles ambiguous document with safe fallback to other_ri_document', () => {
		const result = classifyRiDocumentType({
			title: 'Comunicado de RI sobre atualizacoes',
			subtitle: 'Relacoes com investidores',
			fileName: 'comunicado-ri.pdf',
		});

		expect(result.documentType).toBe('other_ri_document');
		expect(result.confidence).toBe('low');
	});

	it('returns unknown when there are no RI signals', () => {
		const result = classifyRiDocumentType({
			title: 'Politica de privacidade do site',
			fileName: 'politica-privacidade.pdf',
		});

		expect(result.documentType).toBe('unknown');
		expect(result.score).toBe(0);
	});

	it('resolves conflicts by score and then priority', () => {
		const result = classifyRiDocumentType({
			title: 'Fato Relevante e Release de Resultados',
			url: 'https://ri.empresa.com.br/fato-relevante-release.pdf',
		});

		expect(result.documentType).toBe('material_fact');
		expect(result.matchedAliases.length).toBeGreaterThan(0);
	});

	it('normalizes legacy aliases to canonical type', () => {
		expect(normalizeRiDocumentType('other')).toBe('other_ri_document');
		expect(normalizeRiDocumentType('presentation')).toBe(
			'investor_presentation'
		);
	});
});
