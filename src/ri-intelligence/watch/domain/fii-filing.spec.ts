import {
	FiiFiling,
	fiiFilingToRecord,
} from 'src/ri-intelligence/watch/domain/fii-filing';
import {
	isMaterialFactFiling,
	isWatchRelevant,
	watchDocumentKey,
} from 'src/ri-intelligence/watch/domain/ri-watch';

/** Documento do HGLG11 como a FundosNet listou em 03/10/2026. */
function filing(over: Partial<FiiFiling> = {}): FiiFiling {
	return {
		id: '1327262',
		fund: 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO',
		category: 'Relatórios',
		type: 'Relatório Gerencial',
		species: null,
		referenceDate: '2026-08-31',
		deliveredOn: '2026-09-23',
		downloadUrl:
			'https://fnet.bmfbovespa.com.br/fnet/publico/downloadDocumento?id=1327262',
		active: true,
		structured: false,
		...over,
	};
}

describe('fiiFilingToRecord (TRA-266)', () => {
	it('builds the same record the company sources build', () => {
		const record = fiiFilingToRecord(filing(), 'HGLG11');

		expect(record).toEqual({
			id: 'HGLG11:management_report:2026-09-23T00:00:00.000Z:1327262:fnet',
			ticker: 'HGLG11',
			company: 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO',
			title: 'Relatórios - Relatório Gerencial',
			documentType: 'management_report',
			period: '08/2026',
			publishedAt: '2026-09-23T00:00:00.000Z',
			source: {
				type: 'url',
				value:
					'https://fnet.bmfbovespa.com.br/fnet/publico/downloadDocumento?id=1327262',
			},
			classification: { method: 'deterministic_rules', confidence: 'high' },
			contentStatus: 'metadata_only',
			cvmCategory: 'Relatórios',
			cvmType: 'Relatório Gerencial',
		});
	});

	// O id da FundosNet nao e o protocolo do ENET: a identidade e o link.
	it('identifies the document by its download link, stable across runs', () => {
		const record = fiiFilingToRecord(filing(), 'HGLG11');

		expect(record.deliveryProtocol).toBeUndefined();
		expect(watchDocumentKey(record)).toBe(
			watchDocumentKey(fiiFilingToRecord(filing(), 'HGLG11'))
		);
		expect(watchDocumentKey(record)).not.toBe(
			watchDocumentKey(
				fiiFilingToRecord(
					filing({
						id: '1338095',
						downloadUrl:
							'https://fnet.bmfbovespa.com.br/fnet/publico/downloadDocumento?id=1338095',
					}),
					'HGLG11'
				)
			)
		);
	});

	it.each([
		[{ category: 'Fato Relevante', type: null }, 'material_fact'],
		[{ category: 'Aviso aos Cotistas', type: null }, 'shareholder_notice'],
		[
			{ category: 'Informes Periódicos', type: 'Demonstrações Financeiras' },
			'financial_statement',
		],
	])('types %p as %p by the official category', (over, documentType) => {
		expect(fiiFilingToRecord(filing(over), 'HGLG11').documentType).toBe(
			documentType
		);
	});

	// Data de referencia de fato relevante e o dia do fato, nao um periodo.
	it('has no period outside reports and periodic filings', () => {
		const record = fiiFilingToRecord(
			filing({
				category: 'Fato Relevante',
				type: null,
				referenceDate: '2026-10-01',
			}),
			'HGLG11'
		);

		expect(record.period).toBeNull();
		expect(record.title).toBe('Fato Relevante');
	});

	// TRA-261: fato relevante sai por e-mail por padrao, pela categoria oficial.
	it('marks a FII material fact for the default e-mail', () => {
		const record = fiiFilingToRecord(
			filing({ category: 'Fato Relevante', type: null }),
			'HGLG11'
		);

		expect(isMaterialFactFiling(record)).toBe(true);
	});
});

describe('FII relevance (TRA-266)', () => {
	it.each([
		[{ category: 'Fato Relevante', type: null }],
		[{ category: 'Relatórios', type: 'Relatório Gerencial' }],
		[{ category: 'Relatórios', type: 'Relatório Anual' }],
		[{ category: 'Aviso aos Cotistas', type: null }],
		[{ category: 'Comunicado ao Mercado', type: null }],
		[{ category: 'Informes Periódicos', type: 'Demonstrações Financeiras' }],
	])('keeps %p', (over) => {
		expect(isWatchRelevant(fiiFilingToRecord(filing(over), 'HGLG11'))).toBe(
			true
		);
	});

	it.each([
		[{ category: 'Regulamento', type: null }],
		[
			{
				category: 'Atos de Deliberação do Administrador',
				type: 'Instrumento Particular de Alteração do Regulamento',
			},
		],
		[
			{
				category: 'Oferta Pública de Distribuição de Cotas',
				type: 'Aviso ao Mercado',
			},
		],
		[{ category: 'Relatórios', type: 'Relatório de Agência de Rating' }],
		[{ category: 'Informes Periódicos', type: 'Informe Trimestral' }],
		[{ category: 'Assembleia', type: 'Edital de Convocação' }],
	])('drops %p', (over) => {
		expect(isWatchRelevant(fiiFilingToRecord(filing(over), 'HGLG11'))).toBe(
			false
		);
	});
});
