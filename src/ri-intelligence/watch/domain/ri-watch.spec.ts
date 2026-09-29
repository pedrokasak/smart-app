import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import {
	isPermanentContentFailure,
	isWatchRelevant,
	watchDocumentKey,
} from 'src/ri-intelligence/watch/domain/ri-watch';

function record(over: Partial<RiDocumentRecord> = {}): RiDocumentRecord {
	return {
		id: 'PETR4:material_fact:2026-09-28T00:00:00.000Z:abc:cvm',
		ticker: 'PETR4',
		company: 'Petrobras',
		title: 'Fato Relevante - Aquisição',
		documentType: 'material_fact',
		period: null,
		publishedAt: '2026-09-28T00:00:00.000Z',
		source: { type: 'url', value: 'https://www.rad.cvm.gov.br/enet/doc-1' },
		classification: { method: 'deterministic_rules', confidence: 'high' },
		contentStatus: 'metadata_only',
		...over,
	};
}

describe('ri-watch domain (TRA-240)', () => {
	it('derives a stable key from the document link', () => {
		expect(watchDocumentKey(record())).toBe(watchDocumentKey(record()));
		expect(watchDocumentKey(record())).toMatch(/^[a-f0-9]{24}$/);
		expect(
			watchDocumentKey(
				record({ source: { type: 'url', value: 'https://rad/doc-2' } })
			)
		).not.toBe(watchDocumentKey(record()));
	});

	it('has no key without a link', () => {
		expect(
			watchDocumentKey(record({ source: { type: 'url', value: '  ' } }))
		).toBeNull();
	});

	// TRA-260: o mesmo documento chega pela consulta diaria do ENET e, dias
	// depois, pelo IPE semanal — com links e titulos diferentes. O protocolo
	// de entrega e o que as duas fontes tem em comum.
	it('uses the CVM delivery protocol as the identity across sources', () => {
		const fromEnet = record({
			source: {
				type: 'url',
				value:
					'https://www.rad.cvm.gov.br/ENETWeb/frmDownloadDocumento.aspx?numProtocolo=1571942',
			},
			deliveryProtocol: '1571942',
		});
		const fromIpe = record({
			source: {
				type: 'url',
				value:
					'https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?numProtocolo=1571942',
			},
			deliveryProtocol: '1571942',
		});

		expect(watchDocumentKey(fromEnet)).toBe(watchDocumentKey(fromIpe));
		expect(watchDocumentKey(fromEnet)).not.toBe(
			watchDocumentKey(record({ deliveryProtocol: '1571943' }))
		);
		// Sem o campo, o protocolo sai do link: mesma chave.
		expect(watchDocumentKey({ ...fromIpe, deliveryProtocol: undefined })).toBe(
			watchDocumentKey(fromEnet)
		);
	});

	it.each([
		'earnings_release',
		'material_fact',
		'dividend_notice',
		'shareholder_notice',
		'financial_statement',
		'investor_presentation',
	] as const)('watches %s', (documentType) => {
		expect(isWatchRelevant(record({ documentType }))).toBe(true);
	});

	it.each(['other_ri_document', 'unknown', 'reference_form'] as const)(
		'ignores %s',
		(documentType) => {
			expect(isWatchRelevant(record({ documentType }))).toBe(false);
		}
	);

	// TRA-260: para documento da CVM vale a classificacao OFICIAL (categoria
	// e tipo). O classificador por palavra-chave rotula todo "Comunicado ao
	// Mercado" como fato relevante — inclusive a categoria que a propria CVM
	// chama de "nao considerados fatos relevantes" (226 de 238 num dia real).
	it.each([
		['Fato Relevante', null, true],
		[
			'Dados Econômico-Financeiros',
			'Demonstrações Financeiras Intermediárias',
			true,
		],
		['Aviso aos Acionistas', 'Outros avisos', true],
		['Relatório Proventos', null, true],
		[
			'Comunicado ao Mercado',
			'Aquisição/Alienação de Participação Acionária Relevante',
			true,
		],
		[
			'Comunicado ao Mercado',
			'Outros Comunicados Não Considerados Fatos Relevantes',
			false,
		],
		['Assembleia', 'AGE', false],
		['Reunião da Administração', 'Conselho de Administração', false],
		[
			'Documentos de Oferta de Distribuição Pública',
			'Anúncio de Encerramento de Distribuição Pública',
			false,
		],
	])('CVM filing %s / %s relevant: %s', (cvmCategory, cvmType, expected) => {
		// documentType fica "material_fact" de proposito: e o que o classificador
		// devolve para comunicados, e a taxonomia oficial tem de prevalecer.
		expect(
			isWatchRelevant(
				record({ documentType: 'material_fact', cvmCategory, cvmType })
			)
		).toBe(expected);
	});

	// Provento aprovado em ata (categoria fora da lista) continua relevante
	// pela palavra-chave; ja "comunicado" e "assembleia" pela palavra-chave
	// nao voltam — era esse o ruido.
	const OTHER_NOTICES = 'Outros Comunicados Não Considerados Fatos Relevantes';
	it.each([
		[
			'Reunião da Administração',
			'Conselho de Administração',
			'dividend_notice',
			true,
		],
		['Comunicado ao Mercado', OTHER_NOTICES, 'earnings_release', true],
		['Comunicado ao Mercado', OTHER_NOTICES, 'material_fact', false],
		['Assembleia', 'AGE', 'shareholder_notice', false],
	] as const)(
		'CVM filing %s / %s classified %s by keyword relevant: %s',
		(cvmCategory, cvmType, documentType, expected) => {
			expect(
				isWatchRelevant(record({ documentType, cvmCategory, cvmType }))
			).toBe(expected);
		}
	);

	it('ignores documents that are not a downloadable link', () => {
		expect(
			isWatchRelevant(record({ source: { type: 'file', value: 'x.pdf' } }))
		).toBe(false);
	});

	it('treats only unrecoverable extraction failures as permanent', () => {
		expect(isPermanentContentFailure('empty_after_extract')).toBe(true);
		expect(isPermanentContentFailure('not_pdf')).toBe(true);
		expect(isPermanentContentFailure('fetch_failed')).toBe(false);
		expect(isPermanentContentFailure(undefined)).toBe(false);
	});
});
