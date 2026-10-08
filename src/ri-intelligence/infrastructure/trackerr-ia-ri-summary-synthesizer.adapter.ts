import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { trackerrIaHeaders } from 'src/ai/infrastructure/trackerr-ia-request';
import {
	RiSummarySynthesisError,
	RiSummarySynthesisInput,
	RiSummarySynthesisOutput,
	RiSummarySynthesizerPort,
} from 'src/ri-intelligence/application/ri-summary-synthesizer.port';
import { RiSummaryCitation } from 'src/ri-intelligence/application/ri-summary.types';

/**
 * Teto do texto enviado ao modelo (~15k tokens). O PDF pode ter ate 25 MB
 * (`HttpPdfRiDocumentContentAdapter`); formulario de referencia inteiro
 * estouraria contexto e custo. Release e fato relevante cabem inteiros; nos
 * documentos longos o inicio e onde ficam os destaques. O trackerr-ia corta
 * no mesmo ponto, entao mandar mais so gastaria rede.
 */
export const RI_SYNTHESIS_MAX_CHARS = 60_000;

/** `detail` do trackerr-ia vira motivo de log só se for um código curto. */
const SAFE_REASON = /^[a-z0-9_]{1,60}$/;

/**
 * Traduz a falha da chamada HTTP em um motivo acionável (TRA-275). Antes, o
 * erro subia cru e o serviço o descartava: "IA falhou" sem dizer se era cota
 * do provedor, modelo inexistente, timeout ou o guardrail.
 */
export function classifySynthesisFailure(
	error: unknown
): RiSummarySynthesisError {
	if (error instanceof RiSummarySynthesisError) return error;
	const err = error as {
		code?: string;
		message?: string;
		response?: { status?: number; data?: { detail?: unknown } };
	};
	const status = Number(err?.response?.status) || null;
	const detail = err?.response?.data?.detail;
	const safeDetail =
		typeof detail === 'string' && SAFE_REASON.test(detail) ? detail : null;

	if (status === 422) {
		// Guardrail do trackerr-ia barrou a saída do modelo.
		return new RiSummarySynthesisError(
			'rejected',
			safeDetail ?? 'rejected',
			422
		);
	}
	if (status !== null) {
		return new RiSummarySynthesisError(
			'provider_unavailable',
			safeDetail ?? `http_${status}`,
			status
		);
	}
	const timedOut =
		err?.code === 'ECONNABORTED' ||
		err?.code === 'ETIMEDOUT' ||
		/timeout/i.test(String(err?.message || ''));
	return new RiSummarySynthesisError(
		'provider_unavailable',
		timedOut ? 'timeout' : 'network'
	);
}

interface TrackerrIaRiSummaryResponse {
	highlights?: unknown;
	narrative?: unknown;
	provider?: string | null;
	citations?: unknown;
}

/**
 * Citacoes que o trackerr-ia validou contra o documento (TRA-239). Mesmo
 * vindo de servico interno, a resposta e conferida aqui: citacao malformada
 * ou de destaque que nao voltou e descartada, e pagina invalida vira `null`
 * sem derrubar o trecho.
 */
function readCitations(
	raw: unknown,
	highlights: string[]
): RiSummaryCitation[] {
	if (!Array.isArray(raw)) return [];
	const known = new Set(highlights);
	const citations: RiSummaryCitation[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const { highlight, excerpt, page } = item as Record<string, unknown>;
		if (typeof highlight !== 'string' || !known.has(highlight)) continue;
		if (typeof excerpt !== 'string' || !excerpt.trim()) continue;
		citations.push({
			highlight,
			excerpt: excerpt.trim(),
			page:
				Number.isInteger(page) && (page as number) > 0
					? (page as number)
					: null,
		});
	}
	return citations;
}

/**
 * Sintetizador do resumo de RI via trackerr-ia (TRA-238).
 *
 * Preenche o `RI_SUMMARY_SYNTHESIZER`, que o `RiDocumentSummaryService`
 * injetava como opcional e que nenhum modulo registrava — todo resumo caia
 * em `structured_fallback` com `ri_ai_summarizer_unavailable`.
 *
 * Mesmo principio das duas fontes do chat (TRA-10): o server estabelece os
 * FATOS (texto extraido, sinais por regra); o trackerr-ia so NARRA. O
 * guardrail especifico de RI roda la, antes de a resposta voltar.
 *
 * Contrato de erro oposto ao do sintetizador do chat: aqui a falha VIRA
 * excecao. O servico captura, devolve o resumo estruturado com
 * `ri_ai_summary_failed` e — o que importa — nao grava nada em cache. Um
 * resumo vazio devolvido como sucesso seria cacheado por 30 dias.
 */
@Injectable()
export class TrackerrIaRiSummarySynthesizerAdapter implements RiSummarySynthesizerPort {
	private readonly trackerIaUrl =
		process.env.TRAKKER_IA_URL || 'http://localhost:8000';

	// Resumir um release leva mais que responder o chat: o modelo le o
	// documento inteiro. O usuario ja espera o download e a extracao do PDF.
	private static readonly TIMEOUT_MS = 45_000;

	constructor(private readonly httpService: HttpService) {}

	async summarize(
		input: RiSummarySynthesisInput
	): Promise<RiSummarySynthesisOutput> {
		const { document } = input;
		let response: { data?: TrackerrIaRiSummaryResponse };
		try {
			response = await firstValueFrom(
				this.httpService.post<TrackerrIaRiSummaryResponse>(
					`${this.trackerIaUrl}/api/ri/summarize`,
					{
						// Cortes nos mesmos limites do schema do trackerr-ia: um titulo
						// raspado longo demais viraria 422 e o documento nunca teria
						// resumo por IA.
						document: {
							ticker: String(document.ticker || '').slice(0, 20),
							company: String(document.company || '').slice(0, 200),
							document_type: document.documentType,
							title: document.title ? document.title.slice(0, 300) : null,
							period: document.period ? document.period.slice(0, 40) : null,
							published_at: document.publishedAt ?? null,
						},
						content: String(input.content || '').slice(
							0,
							RI_SYNTHESIS_MAX_CHARS
						),
						structured_signals: input.structuredSignals,
					},
					{
						headers: trackerrIaHeaders(),
						timeout: TrackerrIaRiSummarySynthesizerAdapter.TIMEOUT_MS,
					}
				)
			);
		} catch (error) {
			throw classifySynthesisFailure(error);
		}

		const data = response.data ?? {};
		const highlights = Array.isArray(data.highlights)
			? data.highlights.filter(
					(item): item is string =>
						typeof item === 'string' && item.trim().length > 0
				)
			: [];
		const narrative =
			typeof data.narrative === 'string' ? data.narrative.trim() : '';

		if (!highlights.length && !narrative) {
			throw new RiSummarySynthesisError('rejected', 'ri_summary_empty');
		}

		return {
			highlights,
			narrative,
			citations: readCitations(data.citations, highlights),
			metadata: data.provider ? { model: data.provider } : undefined,
		};
	}
}
