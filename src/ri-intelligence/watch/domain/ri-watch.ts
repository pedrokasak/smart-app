import { createHash } from 'crypto';
import { cvmDeliveryProtocol } from 'src/ri-intelligence/domain/cvm-protocol';
import {
	RiDocumentRecord,
	RiDocumentType,
} from 'src/ri-intelligence/domain/ri-document.types';

/**
 * Vigia de RI (TRA-240): documentos que a varredura registra e processa.
 *
 * Nem todo documento entregue a CVM interessa a quem tem o papel. O IPE traz
 * tambem formularios mensais de negociacao, atas de rotina e comunicados
 * genericos — resumir tudo isso gastaria IA com ruido. Ficam os tipos que
 * mudam a leitura da empresa: resultado, fato relevante, proventos, aviso ao
 * acionista, demonstracoes e apresentacao de resultado.
 */
export const RI_WATCH_RELEVANT_TYPES: ReadonlySet<RiDocumentType> =
	new Set<RiDocumentType>([
		'earnings_release',
		'material_fact',
		'dividend_notice',
		'shareholder_notice',
		'financial_statement',
		'investor_presentation',
	]);

/** Tentativas antes de desistir de um documento (falha transitoria). */
export const RI_WATCH_MAX_ATTEMPTS = 3;

export type RiWatchStatus = 'pending' | 'summarized' | 'skipped' | 'failed';

/** O que fica do resumo para os proximos passos (notificacao, acervo). */
export interface RiWatchSummarySnapshot {
	highlights: string[];
	citations: { highlight: string; excerpt: string; page: number | null }[];
}

export interface RiWatchDocument {
	key: string;
	ticker: string;
	documentType: RiDocumentType;
	publishedAt: string;
	/**
	 * O registro EXATAMENTE como a descoberta devolveu. O resumo e cacheado
	 * por id + titulo + empresa + conteudo (TRA-238); resumir a partir desta
	 * copia e o que faz o resumo pre-gerado ser cache hit para quem abrir o
	 * documento pelo RI Inteligente. Veio do ENET e a tela lista pelo IPE
	 * (outro id e titulo)? Vale a chave do protocolo (TRA-260).
	 */
	record: RiDocumentRecord;
	status: RiWatchStatus;
	attempts: number;
	discoveredAt: string;
	processedAt?: string | null;
	lastError?: string | null;
	summary?: RiWatchSummarySnapshot | null;
}

/**
 * Chave do documento no vigia. Com protocolo de entrega da CVM, e ele
 * (TRA-260): o mesmo documento chega pela consulta diaria do ENET e, dias
 * depois, pelo IPE semanal, com link e titulo diferentes — o protocolo e o
 * que as duas fontes compartilham. Sem protocolo (documento de fora da CVM),
 * vale o link de download, que nao depende de janela de consulta.
 */
export function watchDocumentKey(
	record: Pick<RiDocumentRecord, 'source' | 'deliveryProtocol'>
): string | null {
	const protocol = cvmDeliveryProtocol(record);
	const identity = protocol
		? `cvm-protocol:${protocol}`
		: String(record?.source?.value || '').trim();
	if (!identity) return null;
	return createHash('sha256').update(identity).digest('hex').slice(0, 24);
}

/**
 * Tipos que a palavra-chave do titulo reconhece bem o bastante para valer
 * mesmo fora das categorias relevantes da CVM (TRA-260): provento aprovado
 * em ata de reuniao ("Pagamento de JCP Intermediario", 3 das 19 atas de
 * 28/09/2026) ou release entregue como comunicado generico. Ficam de fora
 * `material_fact` e `shareholder_notice`: a palavra-chave marca todo
 * "comunicado" como fato relevante e toda assembleia como aviso — era o
 * ruido que a categoria oficial veio cortar.
 */
const KEYWORD_TYPES_OVER_CATEGORY: ReadonlySet<RiDocumentType> =
	new Set<RiDocumentType>([
		'earnings_release',
		'dividend_notice',
		'financial_statement',
		'investor_presentation',
	]);

export function isWatchRelevant(record: RiDocumentRecord): boolean {
	if (record.source?.type !== 'url' || watchDocumentKey(record) === null) {
		return false;
	}
	// Documento da CVM: vale a classificacao oficial da entrega (TRA-260).
	if (record.cvmCategory) {
		return (
			isRelevantCvmFiling(record.cvmCategory, record.cvmType) ||
			KEYWORD_TYPES_OVER_CATEGORY.has(record.documentType)
		);
	}
	return RI_WATCH_RELEVANT_TYPES.has(record.documentType);
}

function fold(value: string | null | undefined): string {
	return String(value ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

/** Categorias da CVM que mudam a leitura da empresa, qualquer que seja o tipo. */
const RELEVANT_CVM_CATEGORIES: ReadonlySet<string> = new Set([
	'fato relevante',
	'dados economico-financeiros',
	'aviso aos acionistas',
	'relatorio proventos',
]);

/**
 * Relevancia pela classificacao OFICIAL da CVM (TRA-260). "Comunicado ao
 * Mercado" entra pelo tipo: "Aquisicao/Alienacao de Participacao Acionaria
 * Relevante" ou "Esclarecimentos sobre questionamentos" importam; "Outros
 * Comunicados Nao Considerados Fatos Relevantes" e a propria CVM dizendo que
 * nao — e era a maioria dos documentos de um dia (226 de 361 em 28/09/2026).
 * Assembleias, reunioes da administracao e documentos de oferta ficam de
 * fora: sao rotina, e virariam alerta diario de ruido.
 */
export function isRelevantCvmFiling(
	category: string | null | undefined,
	type: string | null | undefined
): boolean {
	const normalizedCategory = fold(category);
	if (RELEVANT_CVM_CATEGORIES.has(normalizedCategory)) return true;
	if (normalizedCategory === 'comunicado ao mercado') {
		return (
			fold(type) !== 'outros comunicados nao considerados fatos relevantes'
		);
	}
	return false;
}

/**
 * Falhas de extracao que uma nova tentativa nao resolve: PDF escaneado sem
 * texto, arquivo que nao e PDF, grande demais ou link rejeitado. Rede fora
 * do ar e erro de parse passageiro ficam de fora — esses valem retry.
 */
const PERMANENT_CONTENT_FAILURES: ReadonlySet<string> = new Set([
	'empty_url',
	'link_invalid',
	'not_pdf',
	'too_large',
	'empty_after_extract',
]);

export function isPermanentContentFailure(reason: string | undefined): boolean {
	return Boolean(reason) && PERMANENT_CONTENT_FAILURES.has(reason as string);
}
