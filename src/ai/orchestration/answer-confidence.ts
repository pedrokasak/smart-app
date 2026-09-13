import type {
	ChatOrchestratorIntent,
	ChatOrchestratorResponse,
} from 'src/ai/orchestration/chat-orchestrator.types';

/**
 * Índice de confiança e fontes da resposta do Copiloto (TRA-141): o
 * "confiança 92%" e os chips de fonte da bolha do handoff.
 *
 * ## De onde vem o número
 *
 * O Copiloto responde por dois caminhos, e a confiança de cada um mede uma
 * coisa diferente:
 *
 * - **Cálculo determinístico** (risco, correlação, aporte, proventos…): a
 *   conta em si é exata. O que pode falhar é a COBERTURA — dado indisponível,
 *   premissa assumida, série curta. A confiança parte de alta e desconta cada
 *   lacuna declarada em `unavailable` e `assumptions`.
 * - **RAG do trackerr-ia** (perguntas abertas, plano Pro+): o texto é narrado
 *   sobre trechos recuperados do contexto do usuário. O RAG não devolve nota de
 *   relevância, só quantos trechos usou; mais trechos, mais apoio. Sem trecho
 *   (ou com o fallback genérico), a confiança é baixa — e é dita.
 *
 * Recusa honesta ("ainda não calculo VaR por fator") não tem confiança: não é
 * uma resposta sobre a carteira.
 *
 * Nada aqui é probabilidade calibrada; é um índice de qualidade do dado que
 * sustentou a resposta, e o nome na tela é "confiança", como no protótipo.
 */

export type ConfidenceBasis = 'deterministic' | 'rag' | 'fallback' | 'refusal';

export interface AnswerConfidence {
	/** 0-1. `null` em recusa. */
	score: number | null;
	basis: ConfidenceBasis;
}

const round2 = (value: number): number => Number(value.toFixed(2));
const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

export function computeAnswerConfidence(input: {
	routeType: 'deterministic_no_llm' | 'synthesis_required';
	routeReason: string;
	unavailable: string[];
	assumptions: string[];
	narrativeMode?: 'llm_synthesized' | 'deterministic_fallback' | null;
	ragChunkCount?: number | null;
}): AnswerConfidence {
	if (input.routeReason === 'capability_not_available') {
		return { score: null, basis: 'refusal' };
	}

	if (input.routeType === 'synthesis_required') {
		const chunks = Number(input.ragChunkCount) || 0;
		if (input.narrativeMode === 'llm_synthesized' && chunks > 0) {
			return {
				score: round2(clamp(0.6 + 0.05 * Math.min(chunks, 6), 0, 0.9)),
				basis: 'rag',
			};
		}
		return { score: 0.4, basis: 'fallback' };
	}

	const base =
		input.routeReason === 'insufficient_structured_data' ? 0.55 : 0.95;
	const unavailablePenalty = Math.min(0.3, 0.1 * input.unavailable.length);
	const assumptionPenalty = Math.min(0.15, 0.05 * input.assumptions.length);
	return {
		score: round2(clamp(base - unavailablePenalty - assumptionPenalty, 0.3, 1)),
		basis: 'deterministic',
	};
}

const PRICE_SERIES_INTENTS: ChatOrchestratorIntent[] = [
	'correlation_matrix',
	'return_attribution',
	'benchmark_simple',
];

const POLICY_INTENTS: ChatOrchestratorIntent[] = [
	'allocation_gap',
	'contribution_simulation',
	'action_checklist',
];

/**
 * Chips de fonte da bolha, com os rótulos do protótipo ("Posições
 * consolidadas", "Política de investimento", "Séries de preço 252d"). Só lista
 * o que a resposta de fato usou.
 */
export function buildAnswerSources(input: {
	intent: ChatOrchestratorIntent;
	positionsCount: number;
	data: ChatOrchestratorResponse['data'];
	ragChunkCount?: number | null;
}): string[] {
	const sources: string[] = [];
	if (
		input.positionsCount > 0 &&
		input.intent !== 'unsupported_quant_analysis'
	) {
		sources.push('Posições consolidadas');
	}
	const rebalancing = input.data?.rebalancing as
		| { hasTarget?: boolean }
		| undefined;
	if (POLICY_INTENTS.includes(input.intent) && rebalancing?.hasTarget) {
		sources.push('Política de investimento');
	}
	if (PRICE_SERIES_INTENTS.includes(input.intent)) {
		sources.push('Séries de preço 252d');
	}
	if (input.intent === 'dividends_received' && input.data?.dividendsReceived) {
		sources.push('Histórico de proventos');
	}
	const chunks = Number(input.ragChunkCount) || 0;
	if (chunks > 0) {
		sources.push(
			`Seu histórico · ${chunks} ${chunks === 1 ? 'trecho' : 'trechos'}`
		);
	}
	return sources;
}
