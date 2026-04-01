export interface ChatCostObservation {
	routeType: 'deterministic_no_llm' | 'synthesis_required';
	cacheHit: boolean;
	llmEligible: boolean;
	estimatedLlmCallsAvoided: number;
}

export interface ChatCostObserverPort {
	record(observation: ChatCostObservation): Promise<void> | void;
}

export const CHAT_COST_OBSERVER = Symbol('CHAT_COST_OBSERVER');
