import { classifyRiDocumentType } from 'src/ri-intelligence/domain/ri-document-classifier';
import {
	RiDocumentRecord,
	RiDocumentType,
} from 'src/ri-intelligence/domain/ri-document.types';

/**
 * Um documento de FII como a FundosNet da B3 lista (TRA-266): o sistema
 * oficial onde os administradores entregam os documentos dos fundos, no dia
 * da entrega. E o equivalente, para FII, da consulta do ENET das companhias.
 */
export interface FiiFiling {
	/** Id do documento na FundosNet. E a identidade dele: vai no link. */
	id: string;
	/** Nome do fundo (ou da classe) como a FundosNet mostra. */
	fund: string;
	category: string;
	type: string | null;
	species: string | null;
	/** Data de referencia, ISO `AAAA-MM-DD` (mes sem dia vira o dia 01). */
	referenceDate: string | null;
	/** Dia da entrega, ISO `AAAA-MM-DD`, no horario de Brasilia. */
	deliveredOn: string;
	downloadUrl: string;
	/** `false` quando substituido por nova versao ou cancelado. */
	active: boolean;
	/**
	 * Informe estruturado (XML): informe mensal, aviso de rendimentos. Nao e
	 * PDF, nao tem texto para resumir nem para o acervo do chat.
	 */
	structured: boolean;
}

function fold(value: string | null | undefined): string {
	return String(value ?? '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Tipo do documento pela classificacao OFICIAL da FundosNet, quando ela
 * diz o que o documento e. O classificador por palavra-chave fica para o
 * resto: ele nao conhece "relatorio gerencial" nem "aviso aos cotistas".
 */
function officialDocumentType(filing: FiiFiling): RiDocumentType | null {
	const category = fold(filing.category);
	const type = fold(filing.type);
	if (category === 'fato relevante') return 'material_fact';
	if (category === 'aviso aos cotistas') return 'shareholder_notice';
	if (category === 'relatorios' && type.startsWith('relatorio gerencial')) {
		return 'management_report';
	}
	if (type === 'demonstracoes financeiras') return 'financial_statement';
	return null;
}

/**
 * Periodo de um relatorio ou informe periodico ("08/2026"): o mes a que ele
 * se refere. Fato relevante e aviso nao tem periodo — a data de referencia
 * deles e o dia do fato.
 */
function periodOf(filing: FiiFiling): string | null {
	const category = fold(filing.category);
	if (category !== 'relatorios' && category !== 'informes periodicos') {
		return null;
	}
	const match = /^(\d{4})-(\d{2})/.exec(filing.referenceDate ?? '');
	return match ? `${match[2]}/${match[1]}` : null;
}

/**
 * Converte o documento no mesmo registro que as fontes de companhia
 * produzem, para o resto do vigia (relevancia, resumo, aviso, acervo) nao
 * distinguir FII de acao. A categoria oficial vai em `cvmCategory`: e por
 * ela que o vigia decide a relevancia e o aviso por e-mail de fato
 * relevante.
 *
 * Sem `deliveryProtocol`: o id da FundosNet nao e o protocolo de entrega
 * do ENET. A identidade no vigia fica sendo o link de download, que carrega
 * o id e nao muda entre rodadas.
 */
export function fiiFilingToRecord(
	filing: FiiFiling,
	ticker: string
): RiDocumentRecord {
	const title = [filing.category, filing.type, filing.species]
		.map((part) => String(part ?? '').trim())
		.filter((part) => part && part !== '-')
		.join(' - ');
	const official = officialDocumentType(filing);
	const classified = classifyRiDocumentType({
		title,
		url: filing.downloadUrl,
	});
	const documentType = official ?? classified.documentType;
	// Meia-noite UTC do dia da entrega: a mesma convencao das fontes da CVM.
	const publishedAt = `${filing.deliveredOn}T00:00:00.000Z`;

	return {
		id: `${ticker}:${documentType}:${publishedAt}:${filing.id}:fnet`,
		ticker,
		company: filing.fund,
		title,
		documentType,
		period: periodOf(filing),
		publishedAt,
		source: { type: 'url', value: filing.downloadUrl },
		classification: official
			? { method: 'deterministic_rules', confidence: 'high' }
			: {
					method: 'deterministic_rules',
					confidence: classified.confidence,
					score: classified.score,
					matchedAliases: classified.matchedAliases,
				},
		contentStatus: 'metadata_only',
		cvmCategory: filing.category || null,
		cvmType: filing.type,
	};
}
