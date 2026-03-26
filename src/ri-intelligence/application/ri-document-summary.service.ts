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
} from 'src/ri-intelligence/application/ri-summary.types';

@Injectable()
export class RiDocumentSummaryService {
	private readonly minContentLength = 220;
	private readonly cacheTtlSeconds = 60 * 30;

	constructor(
		@Optional()
		@Inject(RI_SUMMARY_SYNTHESIZER)
		private readonly synthesizer?: RiSummarySynthesizerPort,
		@Inject(RI_SUMMARY_CACHE)
		private readonly cache?: RiSummaryCachePort<RiDocumentSummaryOutput>
	) {}

	async summarize(input: RiDocumentSummaryInput): Promise<RiDocumentSummaryOutput> {
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

		const cacheKey = this.buildCacheKey(input.document.id, normalizedContent);
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
			const output = this.buildOutput({
				input,
				structuredSignals,
				summaryStatus: 'ai_generated',
				sourceLabel: 'ai_summary',
				highlights: this.limitHighlights(synthesized.highlights || []),
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

	private buildCacheKey(documentId: string, content: string): string {
		const contentHash = createHash('sha256')
			.update(content)
			.digest('hex')
			.slice(0, 12);
		return `ri-summary:${documentId}:${contentHash}:v1`;
	}

	private limitHighlights(items: string[]): string[] {
		return Array.from(
			new Set(
				items
					.map((item) => String(item || '').trim())
					.filter(Boolean)
			)
		).slice(0, 8);
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
		else if (topicDetected && (upDetected || downDetected)) direction = 'neutral';

		return {
			detected: topicDetected,
			direction,
			evidence,
		};
	}
}

