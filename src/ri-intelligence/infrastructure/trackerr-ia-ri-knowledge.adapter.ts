import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { trackerrIaHeaders } from 'src/ai/infrastructure/trackerr-ia-request';
import {
	RiKnowledgeAnswer,
	RiKnowledgeCitation,
	RiKnowledgeDocument,
	RiKnowledgeIndexStatus,
	RiKnowledgePort,
	RiKnowledgeQuestion,
} from 'src/ri-intelligence/application/ri-knowledge.port';

/** Mesmo teto do schema do trackerr-ia (`RI_INDEX_MAX_CONTENT_CHARS`). */
export const RI_INDEX_MAX_CHARS = 1_500_000;

const INDEX_STATUSES: ReadonlySet<string> = new Set([
	'indexed',
	'unchanged',
	'empty',
]);

interface TrackerrIaAskItem {
	text?: unknown;
	citation?: Record<string, unknown> | null;
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Le a resposta do trackerr-ia sem confiar nela: item sem texto, sem trecho
 * ou sem documento sai — o chat nunca mostra afirmacao sem citacao.
 */
function readItems(raw: unknown): RiKnowledgeAnswer['items'] {
	if (!Array.isArray(raw)) return [];
	const items: RiKnowledgeAnswer['items'] = [];
	for (const entry of raw as TrackerrIaAskItem[]) {
		const claim = text(entry?.text);
		const citation = entry?.citation ?? {};
		const documentKey = text(citation.document_key);
		const title = text(citation.title);
		const excerpt = text(citation.excerpt);
		const publishedAt = text(citation.published_at);
		const sourceUrl = text(citation.source_url);
		if (
			!claim ||
			!documentKey ||
			!title ||
			!excerpt ||
			!publishedAt ||
			!sourceUrl
		) {
			continue;
		}
		const page = citation.page;
		const parsed: RiKnowledgeCitation = {
			documentKey,
			title,
			category: text(citation.category),
			period: text(citation.period),
			publishedAt,
			sourceUrl,
			page:
				Number.isInteger(page) && (page as number) > 0
					? (page as number)
					: null,
			excerpt,
		};
		items.push({ text: claim, citation: parsed });
	}
	return items;
}

/** Cliente HTTP do acervo de RI no trackerr-ia (TRA-264). */
@Injectable()
export class TrackerrIaRiKnowledgeAdapter implements RiKnowledgePort {
	private readonly trackerIaUrl =
		process.env.TRAKKER_IA_URL || 'http://localhost:8000';

	// Indexar embeda o documento inteiro, chunk a chunk: um DFP leva minutos.
	// Roda no vigia, fora de requisicao de usuario.
	private static readonly INDEX_TIMEOUT_MS = 180_000;
	// Responder: busca + uma chamada de modelo, com o usuario esperando.
	private static readonly ASK_TIMEOUT_MS = 45_000;

	constructor(private readonly httpService: HttpService) {}

	async index(
		document: RiKnowledgeDocument,
		content: string
	): Promise<RiKnowledgeIndexStatus> {
		const response = await firstValueFrom(
			this.httpService.post<{ status?: unknown }>(
				`${this.trackerIaUrl}/api/ri/index`,
				{
					// Cortes nos limites do schema do trackerr-ia: um titulo longo
					// demais viraria 422 e o documento nunca entraria no acervo.
					document: {
						key: document.key.slice(0, 128),
						issuer: document.issuer.slice(0, 16),
						ticker: document.ticker.slice(0, 20),
						company: (document.company || '').slice(0, 200),
						title: document.title.slice(0, 500),
						category: document.category?.slice(0, 120) ?? null,
						document_type: document.documentType?.slice(0, 60) ?? null,
						period: document.period?.slice(0, 40) ?? null,
						published_at: document.publishedAt,
						source_url: document.sourceUrl.slice(0, 2000),
					},
					content: String(content || '').slice(0, RI_INDEX_MAX_CHARS),
				},
				{
					headers: trackerrIaHeaders(),
					timeout: TrackerrIaRiKnowledgeAdapter.INDEX_TIMEOUT_MS,
				}
			)
		);
		const status = String(response.data?.status ?? '');
		if (!INDEX_STATUSES.has(status)) {
			throw new Error('ri_index_unexpected_response');
		}
		return status as RiKnowledgeIndexStatus;
	}

	async ask(question: RiKnowledgeQuestion): Promise<RiKnowledgeAnswer> {
		const response = await firstValueFrom(
			this.httpService.post<{ answer?: unknown; not_found?: unknown }>(
				`${this.trackerIaUrl}/api/ri/ask`,
				{
					issuer: question.issuer.slice(0, 16),
					question: question.question.slice(0, 500),
					published_after: question.publishedAfter ?? null,
				},
				{
					headers: trackerrIaHeaders(),
					timeout: TrackerrIaRiKnowledgeAdapter.ASK_TIMEOUT_MS,
				}
			)
		);
		const items = readItems(response.data?.answer);
		return { items, notFound: items.length === 0 };
	}
}
