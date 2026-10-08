import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import {
	RI_SUMMARY_CACHE,
	RiSummaryCachePort,
} from 'src/ri-intelligence/application/ri-summary-cache.port';
import {
	RI_SUMMARY_SYNTHESIZER,
	RiSummarySynthesisError,
	RiSummarySynthesizerPort,
} from 'src/ri-intelligence/application/ri-summary-synthesizer.port';
import {
	RiDocumentSummaryInput,
	RiDocumentSummaryOutput,
	RiStructuredSignalItem,
	RiStructuredSignals,
	RiSummaryCitation,
} from 'src/ri-intelligence/application/ri-summary.types';
import { cvmDeliveryProtocol } from 'src/ri-intelligence/domain/cvm-protocol';

/**
 * Versao do prompt nas chaves de cache. v2 (TRA-239): destaques passaram a
 * vir com citacao verificada. Mudou o prompt no trackerr-ia? Suba aqui.
 */
const SUMMARY_CACHE_VERSION = 'v2';

@Injectable()
export class RiDocumentSummaryService {
	private readonly logger = new Logger(RiDocumentSummaryService.name);
	private readonly minContentLength = 220;
	// A chave carrega a hash do conteudo e o documento publicado nao muda:
	// resumo vencido so faria pagar a mesma chamada de novo (TRA-238). Mudou
	// o prompt no trackerr-ia? Suba `SUMMARY_CACHE_VERSION`.
	private readonly cacheTtlSeconds = 60 * 60 * 24 * 30;

	constructor(
		@Optional()
		@Inject(RI_SUMMARY_SYNTHESIZER)
		private readonly synthesizer?: RiSummarySynthesizerPort,
		@Inject(RI_SUMMARY_CACHE)
		private readonly cache?: RiSummaryCachePort<RiDocumentSummaryOutput>
	) {}

	async summarize(
		input: RiDocumentSummaryInput
	): Promise<RiDocumentSummaryOutput> {
		const normalizedContent = this.normalizeContent(input.content);
		const structuredSignals = this.extractStructuredSignals(normalizedContent);

		// Sem a capability, nem o cache e lido: ele guarda resumo de IA, que e
		// justamente o conteudo pago (TRA-238). Vem antes da checagem de
		// conteudo (TRA-253): quem nao tem o resumo no plano nem baixa o PDF,
		// e a resposta certa para ele e "fora do plano", nao "sem conteudo".
		if (input.allowAi === false) {
			return this.buildOutput({
				input,
				structuredSignals,
				summaryStatus: 'ai_failed',
				sourceLabel: 'structured_fallback',
				highlights: [],
				narrative: null,
				limitations: ['ri_ai_summary_not_in_plan'],
				cache: { key: null, hit: false, ttlSeconds: null },
				cost: { aiCalls: 0, tokenUsageEstimate: 0 },
			});
		}

		if (normalizedContent.length < this.minContentLength) {
			const reason = String(input.contentUnavailableReason ?? '').trim();
			return this.buildOutput({
				input,
				structuredSignals,
				summaryStatus: 'insufficient_content',
				sourceLabel: 'structured_fallback',
				highlights: [],
				narrative: null,
				limitations: [
					'ri_content_insufficient_for_summary',
					...(reason ? [`ri_content_${reason}`] : []),
				],
				cache: { key: null, hit: false, ttlSeconds: null },
				cost: { aiCalls: 0, tokenUsageEstimate: 0 },
			});
		}

		const cacheKey = this.buildCacheKey(input.document, normalizedContent);
		const protocolKey = this.buildProtocolCacheKey(
			input.document,
			normalizedContent
		);
		for (const key of [cacheKey, protocolKey]) {
			const cached = key ? await this.readCache(key) : null;
			if (cached) {
				return {
					...cached,
					// O documento de quem pediu: pela chave do protocolo, o resumo
					// pode ter sido gerado a partir de outra listagem do documento.
					document: this.documentView(input.document),
					summary: {
						...cached.summary,
						status: 'cached_ai',
					},
					cache: {
						key,
						hit: true,
						ttlSeconds: this.cacheTtlSeconds,
					},
					cost: {
						aiCalls: 0,
						tokenUsageEstimate: 0,
					},
				};
			}
		}

		if (!this.synthesizer) {
			return this.buildOutput({
				input,
				structuredSignals,
				summaryStatus: 'ai_failed',
				sourceLabel: 'structured_fallback',
				highlights: [],
				narrative: null,
				limitations: ['ri_ai_summarizer_unavailable'],
				cache: { key: cacheKey, hit: false, ttlSeconds: this.cacheTtlSeconds },
				cost: { aiCalls: 0, tokenUsageEstimate: 0 },
			});
		}

		try {
			const synthesized = await this.synthesizer.summarize({
				document: input.document,
				content: normalizedContent,
				structuredSignals,
			});
			const highlights = this.limitHighlights(synthesized.highlights || []);
			const output = this.buildOutput({
				input,
				structuredSignals,
				summaryStatus: 'ai_generated',
				sourceLabel: 'ai_summary',
				highlights,
				citations: this.alignCitations(highlights, synthesized.citations),
				narrative: String(synthesized.narrative || '').trim() || null,
				limitations: [],
				cache: { key: cacheKey, hit: false, ttlSeconds: this.cacheTtlSeconds },
				cost: {
					aiCalls: 1,
					tokenUsageEstimate: Number(synthesized?.metadata?.tokenUsage || 0),
				},
			});
			await this.writeCache(cacheKey, output);
			if (input.serverDiscovered && protocolKey) {
				await this.writeCache(protocolKey, output);
			}
			return output;
		} catch (error) {
			// Antes o erro era descartado aqui, sem log: "IA falhou" não dizia se
			// era cota do provedor, modelo inexistente, timeout ou o guardrail
			// (TRA-275). Só o motivo vai para o log, nunca o conteúdo.
			const failure =
				error instanceof RiSummarySynthesisError
					? error
					: new RiSummarySynthesisError(
							'provider_unavailable',
							(error as Error)?.name || 'unknown'
						);
			this.logger.warn(
				`Resumo de RI por IA falhou (${input.document.ticker || 'sem ticker'}): ` +
					`${failure.kind} · ${failure.reason}` +
					(failure.status ? ` · HTTP ${failure.status}` : '')
			);
			return this.buildOutput({
				input,
				structuredSignals,
				summaryStatus: 'ai_failed',
				sourceLabel: 'structured_fallback',
				highlights: [],
				narrative: null,
				// O genérico continua primeiro: o painel RI Watch lê o primeiro
				// código. O segundo diz o que fazer.
				limitations: [
					'ri_ai_summary_failed',
					failure.kind === 'rejected'
						? 'ri_ai_summary_rejected'
						: 'ri_ai_provider_unavailable',
				],
				cache: { key: cacheKey, hit: false, ttlSeconds: this.cacheTtlSeconds },
				cost: { aiCalls: 1, tokenUsageEstimate: 0 },
			});
		}
	}

	private buildOutput(params: {
		input: RiDocumentSummaryInput;
		structuredSignals: RiStructuredSignals;
		summaryStatus: RiDocumentSummaryOutput['summary']['status'];
		sourceLabel: RiDocumentSummaryOutput['summary']['sourceLabel'];
		highlights: string[];
		citations?: RiSummaryCitation[];
		narrative: string | null;
		limitations: string[];
		cache: RiDocumentSummaryOutput['cache'];
		cost: RiDocumentSummaryOutput['cost'];
	}): RiDocumentSummaryOutput {
		return {
			document: this.documentView(params.input.document),
			summary: {
				status: params.summaryStatus,
				highlights: params.highlights,
				narrative: params.narrative,
				limitations: params.limitations,
				sourceLabel: params.sourceLabel,
				citations: params.citations ?? [],
			},
			structuredSignals: params.structuredSignals,
			cache: params.cache,
			cost: params.cost,
		};
	}

	private documentView(
		document: RiDocumentSummaryInput['document']
	): RiDocumentSummaryOutput['document'] {
		return {
			id: document.id,
			ticker: document.ticker,
			company: document.company,
			documentType: document.documentType,
			period: document.period,
			publishedAt: document.publishedAt,
		};
	}

	// O cache e opcional: falha nele nunca derruba o resumo.
	private async readCache(
		key: string
	): Promise<RiDocumentSummaryOutput | null> {
		if (!this.cache) return null;
		try {
			return (await this.cache.get(key)) ?? null;
		} catch (_error) {
			return null;
		}
	}

	private async writeCache(
		key: string,
		output: RiDocumentSummaryOutput
	): Promise<void> {
		if (!this.cache) return;
		try {
			await this.cache.set(key, output, this.cacheTtlSeconds);
		} catch (_error) {
			// Ignore cache set errors.
		}
	}

	private normalizeContent(content: string | null | undefined): string {
		return String(content || '')
			.replace(/\s+/g, ' ')
			.trim();
	}

	/**
	 * O cache e compartilhado entre usuarios, entao a chave cobre TUDO que
	 * entra no prompt, nao so o texto (TRA-238). Ticker, empresa, periodo e
	 * titulo vem do corpo da requisicao em POST /ri-intelligence/summary:
	 * sem eles na chave, alguem mandaria o id e o PDF verdadeiros com uma
	 * "empresa" contendo instrucoes, e o resumo adulterado ficaria gravado
	 * na chave legitima, servido a todo mundo por 30 dias.
	 */
	private buildCacheKey(
		document: RiDocumentSummaryInput['document'],
		content: string
	): string {
		const promptInputs = JSON.stringify([
			document.ticker ?? null,
			document.company ?? null,
			document.documentType ?? null,
			document.period ?? null,
			document.title ?? null,
			document.publishedAt ?? null,
			content,
		]);
		const inputsHash = createHash('sha256')
			.update(promptInputs)
			.digest('hex')
			.slice(0, 12);
		return `ri-summary:${document.id}:${inputsHash}:${SUMMARY_CACHE_VERSION}`;
	}

	/**
	 * O mesmo documento da CVM em qualquer listagem (TRA-260): protocolo de
	 * entrega + hash do TEXTO. O vigia de RI ve o documento pela consulta
	 * diaria do ENET, com id, titulo e empresa diferentes dos que a tela
	 * recebe do IPE dias depois; pela chave de `buildCacheKey`, o resumo
	 * pre-gerado nunca seria achado — e a IA rodaria de novo, com o usuario
	 * esperando.
	 *
	 * So grava aqui quem passa `serverDiscovered` (rotina do servidor, com
	 * metadado da propria descoberta). Qualquer chamada le, mas so acha o
	 * resumo se o texto que o SERVIDOR extraiu for o mesmo: metadado vindo do
	 * cliente nunca entra no que esta chave serve, e o risco que motivou
	 * `buildCacheKey` (TRA-238) nao volta por aqui.
	 */
	private buildProtocolCacheKey(
		document: RiDocumentSummaryInput['document'],
		content: string
	): string | null {
		const protocol = cvmDeliveryProtocol(document);
		if (!protocol) return null;
		const contentHash = createHash('sha256')
			.update(content)
			.digest('hex')
			.slice(0, 16);
		return `ri-summary:cvm-protocol:${protocol}:${contentHash}:${SUMMARY_CACHE_VERSION}`;
	}

	private limitHighlights(items: string[]): string[] {
		return Array.from(
			new Set(items.map((item) => String(item || '').trim()).filter(Boolean))
		).slice(0, 8);
	}

	/**
	 * Uma citacao por destaque FINAL, na mesma ordem (TRA-239): depois do
	 * dedupe e do corte em 8, nao pode sobrar citacao de destaque que nao
	 * aparece na tela.
	 */
	private alignCitations(
		highlights: string[],
		citations: RiSummaryCitation[] | undefined
	): RiSummaryCitation[] {
		const byHighlight = new Map<string, RiSummaryCitation>();
		for (const citation of citations ?? []) {
			const key = String(citation?.highlight || '').trim();
			if (key && !byHighlight.has(key)) byHighlight.set(key, citation);
		}
		return highlights.flatMap((highlight) => {
			const citation = byHighlight.get(highlight);
			return citation ? [{ ...citation, highlight }] : [];
		});
	}

	private extractStructuredSignals(content: string): RiStructuredSignals {
		const text = String(content || '').toLowerCase();
		return {
			revenue: this.detectSignal(
				text,
				['receita', 'faturamento'],
				['crescimento', 'aumento', 'alta', 'expansao', 'expansão'],
				['queda', 'recuo', 'redução', 'reducao']
			),
			profit: this.detectSignal(
				text,
				['lucro', 'resultado liquido', 'resultado líquido'],
				['crescimento', 'aumento', 'alta', 'melhora'],
				['queda', 'recuo', 'prejuizo', 'prejuízo']
			),
			margin: this.detectSignal(
				text,
				['margem', 'ebitda'],
				['expansao', 'expansão', 'alta', 'melhora'],
				['compressao', 'compressão', 'queda', 'piora']
			),
			indebtedness: this.detectSignal(
				text,
				['divida', 'dívida', 'alavancagem', 'endividamento'],
				['reducao', 'redução', 'queda', 'desalavancagem'],
				['aumento', 'alta', 'piora']
			),
			capex: this.detectSignal(
				text,
				['capex', 'investimentos', 'investimento'],
				['aumento', 'alta', 'expansao', 'expansão'],
				['reducao', 'redução', 'queda', 'corte']
			),
			guidance: this.detectSignal(
				text,
				['guidance', 'projecao', 'projeção', 'perspectiva'],
				['revisao para cima', 'revisão para cima', 'otimista'],
				['revisao para baixo', 'revisão para baixo', 'conservador']
			),
			risks: this.detectSignal(
				text,
				['risco', 'incerteza', 'pressao', 'pressão'],
				['mitigacao', 'mitigação', 'controle'],
				['aumento', 'alta', 'agravamento']
			),
			toneShift: this.detectSignal(
				text,
				['discurso', 'mensagem da administracao', 'mensagem da administração'],
				['mais confiante', 'otimista', 'resiliente'],
				['mais cauteloso', 'mais cautelosa', 'desafio', 'desafios']
			),
		};
	}

	private detectSignal(
		text: string,
		topics: string[],
		positiveCues: string[],
		negativeCues: string[]
	): RiStructuredSignalItem {
		const topicDetected = topics.some((topic) => text.includes(topic));
		const upDetected = positiveCues.some((cue) => text.includes(cue));
		const downDetected = negativeCues.some((cue) => text.includes(cue));
		const evidence = [...topics, ...positiveCues, ...negativeCues]
			.filter((token) => text.includes(token))
			.slice(0, 6);

		let direction: RiStructuredSignalItem['direction'] = 'unknown';
		if (topicDetected && upDetected && !downDetected) direction = 'up';
		else if (topicDetected && downDetected && !upDetected) direction = 'down';
		else if (topicDetected && (upDetected || downDetected))
			direction = 'neutral';

		return {
			detected: topicDetected,
			direction,
			evidence,
		};
	}
}
