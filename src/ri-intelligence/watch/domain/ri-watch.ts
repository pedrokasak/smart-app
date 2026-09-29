import { createHash } from 'crypto';
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
	 * documento pelo RI Inteligente.
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
 * Chave do documento: o link de download. E o mesmo criterio de dedupe do
 * adapter da CVM, e nao depende de janela de consulta nem de posicao.
 */
export function watchDocumentKey(
	record: Pick<RiDocumentRecord, 'source'>
): string | null {
	const link = String(record?.source?.value || '').trim();
	if (!link) return null;
	return createHash('sha256').update(link).digest('hex').slice(0, 24);
}

export function isWatchRelevant(record: RiDocumentRecord): boolean {
	return (
		RI_WATCH_RELEVANT_TYPES.has(record.documentType) &&
		record.source?.type === 'url' &&
		watchDocumentKey(record) !== null
	);
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
