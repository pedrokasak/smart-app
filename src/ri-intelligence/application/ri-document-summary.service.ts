import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import {
	RI_SUMMARY_CACHE,
	RiSummaryCachePort,
} from 'src/ri-intelligence/application/ri-summary-cache.port';
import {
	RI_SUMMARY_SYNTHESIZER,
	RiSummarySynthesizerPort,
} from 'src/ri-intelligence/application/ri-summary-synthesizer.port';
import {
	RiDocumentSummaryInput,
	RiDocumentSummaryOutput,
	RiStructuredSignalItem,
	RiStructuredSignals,
	RiSummaryCitation,
} from 'src/ri-intelligence/application/ri-summary.types';

@Injectable()
export class RiDocumentSummaryService {
	private readonly minContentLength = 220;
	// A chave carrega a hash do conteudo e o documento publicado nao muda:
	// resumo vencido so faria pagar a mesma chamada de novo (TRA-238). Mudou
	// o prompt no trackerr-ia? Suba o sufixo de versao de `buildCacheKey`.
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

		if (normalizedContent.length < this.minContentLength) {
			return this.buildOutput({
				input,
				structuredSignals,
				summaryStatus: 'insufficient_content',
				sourceLabel: 'structured_fallback',
				highlights: [],
				narrative: null,
				limitations: ['ri_content_insufficient_for_summary'],
				cache: { key: null, hit: false, ttlSeconds: null },
				cost: { aiCalls: 0, tokenUsageEstimate: 0 },
			});
		}

		// Sem a capability, nem o cache e lido: ele guarda resumo de IA, que e
		// justamente o conteudo pago (TRA-238).
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

		const cacheKey = this.buildCacheKey(input.document, normalizedContent);
		if (this.cache) {
			try {
				const cached = await this.cache.get(cacheKey);
				if (cached) {
					return {
						...cached,
						summary: {
							...cached.summary,
							status: 'cached_ai',
						},
						cache: {
							key: cacheKey,
							hit: true,
							ttlSeconds: this.cacheTtlSeconds,
						},
						cost: {
							aiCalls: 0,
							tokenUsageEstimate: 0,
						},
					};
				}
			} catch (_error) {
				// Cache is optional and must not break summary flow.
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
			if (this.cache) {
				try {
					await this.cache.set(cacheKey, output, this.cacheTtlSeconds);
				} catch (_error) {
					// Ignore cache set errors.
				}
			}
			return output;
		} catch (_error) {
			return this.buildOutput({
				input,
				structuredSignals,
				summaryStatus: 'ai_failed',
				sourceLabel: 'structured_fallback',
				highlights: [],
				narrative: null,
				limitations: ['ri_ai_summary_failed'],
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
			document: {
				id: params.input.document.id,
				ticker: params.input.document.ticker,
				company: params.input.document.company,
				documentType: params.input.document.documentType,
				period: params.input.document.period,
				publishedAt: params.input.document.publishedAt,
			},
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
		// v2 (TRA-239): destaques passaram a vir com citacao verificada.
		return `ri-summary:${document.id}:${inputsHash}:v2`;
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
