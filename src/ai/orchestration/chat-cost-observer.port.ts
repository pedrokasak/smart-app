export interface ChatCostObservation {
	routeType: 'deterministic_no_llm' | 'synthesis_required';
	cacheHit: boolean;
	llmEligible: boolean;
	estimatedLlmCallsAvoided: number;
}

/**
 * Custo e latência do roteador com tool-calling, por pergunta (TRA-241).
 * Só contagens: a pergunta e a carteira não entram aqui.
 */
export interface ChatToolRoutingObservation {
	trigger: 'unknown' | 'multi_intent';
	/**
	 * routed: respondeu pelas ferramentas; no_tool: o LLM não escolheu
	 * nenhuma; not_supported: nenhum provider com tool calling; failed:
	 * planner fora ou lento; unusable: nenhuma ferramenta escolhida tinha os
	 * dados que pedia.
	 */
	outcome: 'routed' | 'no_tool' | 'not_supported' | 'failed' | 'unusable';
	calls: number;
	intents: string[];
	latencyMs: number;
	provider: string | null;
	inputTokens: number;
	outputTokens: number;
}

export interface ChatCostObserverPort {
	record(observation: ChatCostObservation): Promise<void> | void;
	/** Opcional: quem não coleta o roteador simplesmente não implementa. */
	recordToolRouting?(
		observation: ChatToolRoutingObservation
	): Promise<void> | void;
}

export const CHAT_COST_OBSERVER = Symbol('CHAT_COST_OBSERVER');
