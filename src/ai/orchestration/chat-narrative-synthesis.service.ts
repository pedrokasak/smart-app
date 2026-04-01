import { Inject, Injectable, Optional } from '@nestjs/common';
import { ChatOrchestratorService } from 'src/ai/orchestration/chat-orchestrator.service';
import { ChatOrchestratorResponse } from 'src/ai/orchestration/chat-orchestrator.types';
import {
	CHAT_NARRATIVE_SYNTHESIZER,
	ChatNarrativeSynthesisInput,
	ChatNarrativeSynthesisOutput,
	ChatNarrativeSynthesizerPort,
} from 'src/ai/orchestration/chat-narrative-synthesizer.port';

export interface ChatNarrativeResponse {
	orchestration: ChatOrchestratorResponse;
	narrative: {
		mode: 'deterministic_fallback' | 'llm_synthesized';
		text: string;
	};
}

@Injectable()
export class ChatNarrativeSynthesisService {
	constructor(
		private readonly chatOrchestratorService: ChatOrchestratorService,
		@Optional()
		@Inject(CHAT_NARRATIVE_SYNTHESIZER)
		private readonly narrativeSynthesizer?: ChatNarrativeSynthesizerPort
	) {}

	async respond(
		userId: string,
		question: string,
		options?: {
			marketDataVersion?: string | null;
			enableNarrativeForDeterministic?: boolean;
		}
	): Promise<ChatNarrativeResponse> {
		const orchestration = await this.chatOrchestratorService.orchestrate(
			userId,
			question,
			options
		);

		if (orchestration.route.type === 'deterministic_no_llm') {
			if (
				options?.enableNarrativeForDeterministic &&
				this.narrativeSynthesizer
			) {
				const synthesized = await this.safeSynthesize(orchestration);
				if (synthesized) {
					return {
						orchestration,
						narrative: {
							mode: 'llm_synthesized',
							text: this.resolveSynthesisText(synthesized, orchestration),
						},
					};
				}
			}
			return {
				orchestration,
				narrative: {
					mode: 'deterministic_fallback',
					text: this.buildFallbackNarrative(orchestration),
				},
			};
		}

		if (!this.narrativeSynthesizer) {
			const fallback = this.cloneWithWarning(
				orchestration,
				'narrative_synthesis_unavailable'
			);
			return {
				orchestration: fallback,
				narrative: {
					mode: 'deterministic_fallback',
					text: this.buildFallbackNarrative(fallback),
				},
			};
		}

		try {
			const synthesisInput = this.toSynthesisInput(orchestration);
			const synthesized =
				await this.narrativeSynthesizer.synthesize(synthesisInput);
			return {
				orchestration,
				narrative: {
					mode: 'llm_synthesized',
					text: this.resolveSynthesisText(synthesized, orchestration),
				},
			};
		} catch (_error) {
			const fallback = this.cloneWithWarning(
				orchestration,
				'narrative_synthesis_failed'
			);
			return {
				orchestration: fallback,
				narrative: {
					mode: 'deterministic_fallback',
					text: this.buildFallbackNarrative(fallback),
				},
			};
		}
	}

	private toSynthesisInput(
		orchestration: ChatOrchestratorResponse
	): ChatNarrativeSynthesisInput {
		const facts = this.extractFacts(orchestration);
		const externalData = this.extractExternalData(orchestration);
		const estimates = this.extractEstimates(orchestration);

		return {
			intent: orchestration.intent,
			question: orchestration.question,
			facts,
			externalData,
			estimates,
			limitations: {
				unavailable: orchestration.unavailable,
				warnings: orchestration.warnings,
				assumptions: orchestration.assumptions,
			},
		};
	}

	private extractFacts(orchestration: ChatOrchestratorResponse) {
		const data = orchestration.data || {};
		switch (orchestration.intent) {
			case 'portfolio_summary':
				return {
					portfolioSummary: data.portfolioSummary || null,
				};
			case 'portfolio_risk':
				return {
					portfolioRisk: data.portfolioRisk || null,
				};
			case 'dividend_projection':
				return {
					dividendProjection: data.dividendProjection || null,
				};
			case 'asset_comparison':
				return {
					comparison: data.comparison || null,
				};
			case 'sell_simulation':
			case 'tax_estimation':
				return {
					sellSimulation: data.sellSimulation || null,
				};
			case 'portfolio_fit_analysis':
				return {
					portfolioFit: data.portfolioFit || null,
				};
			case 'external_asset_analysis':
				return {
					ownership: {
						ownedSymbols: orchestration.context.ownedSymbols,
						externalSymbols: orchestration.context.externalSymbols,
					},
				};
			default:
				return null;
		}
	}

	private extractExternalData(orchestration: ChatOrchestratorResponse) {
		const data = orchestration.data || {};
		if (data.externalAsset) {
			return { externalAsset: data.externalAsset };
		}
		if (orchestration.intent === 'asset_comparison' && data.comparison) {
			return { comparison: data.comparison };
		}
		return null;
	}

	private extractEstimates(orchestration: ChatOrchestratorResponse) {
		const data = orchestration.data || {};
		switch (orchestration.intent) {
			case 'portfolio_summary':
				return {
					dividendProjection:
						(data.portfolioSummary as any)?.dividendProjection || null,
				};
			case 'sell_simulation':
			case 'tax_estimation':
				return {
					sellSimulation: data.sellSimulation || null,
				};
			case 'portfolio_fit_analysis':
				return {
					portfolioFit: data.portfolioFit || null,
				};
			case 'asset_comparison':
				return {
					comparison: data.comparison || null,
				};
			default:
				return null;
		}
	}

	private resolveSynthesisText(
		output: ChatNarrativeSynthesisOutput,
		orchestration: ChatOrchestratorResponse
	): string {
		const text = String(output?.text || '').trim();
		if (text) return text;
		return this.buildFallbackNarrative(orchestration);
	}

	private buildFallbackNarrative(
		orchestration: ChatOrchestratorResponse
	): string {
		if (orchestration.intent === 'asset_comparison') {
			return 'Comparação estruturada concluída com base nos dados disponíveis. Revise os blocos de métricas, encaixe e limitações.';
		}
		if (
			orchestration.intent === 'sell_simulation' ||
			orchestration.intent === 'tax_estimation'
		) {
			return 'Simulação fiscal estruturada concluída. Os valores exibidos são determinísticos e dependem dos dados de posição e preço disponíveis.';
		}
		if (orchestration.intent === 'external_asset_analysis') {
			return 'Análise do ativo externo concluída com os dados de mercado disponíveis. Dados ausentes foram sinalizados.';
		}
		if (orchestration.intent === 'portfolio_fit_analysis') {
			return 'Análise de encaixe concluída. Considere impactos em diversificação, concentração e exposição setorial.';
		}
		if (orchestration.intent === 'narrative_synthesis') {
			return 'A pergunta exige síntese narrativa; no momento, use os dados estruturados e as limitações identificadas para decisão.';
		}
		return 'Resposta estruturada concluída com base nos dados determinísticos disponíveis.';
	}

	private cloneWithWarning(
		orchestration: ChatOrchestratorResponse,
		warning: string
	): ChatOrchestratorResponse {
		return {
			...orchestration,
			warnings: Array.from(
				new Set([...(orchestration.warnings || []), warning])
			),
		};
	}

	private async safeSynthesize(
		orchestration: ChatOrchestratorResponse
	): Promise<ChatNarrativeSynthesisOutput | null> {
		if (!this.narrativeSynthesizer) return null;
		try {
			const synthesisInput = this.toSynthesisInput(orchestration);
			return await this.narrativeSynthesizer.synthesize(synthesisInput);
		} catch (_error) {
			return null;
		}
	}
}
