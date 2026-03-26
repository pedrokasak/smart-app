import { ChatOrchestratorIntent } from 'src/ai/orchestration/chat-orchestrator.types';

export interface ChatNarrativeSynthesisInput {
	intent: ChatOrchestratorIntent;
	question: string;
	facts: Record<string, unknown> | null;
	externalData: Record<string, unknown> | null;
	estimates: Record<string, unknown> | null;
	limitations: {
		unavailable: string[];
		warnings: string[];
		assumptions: string[];
	};
}

export interface ChatNarrativeSynthesisOutput {
	text: string;
	metadata?: {
		model?: string;
		tokenUsage?: number;
	};
}

export interface ChatNarrativeSynthesizerPort {
	synthesize(
		input: ChatNarrativeSynthesisInput
	): Promise<ChatNarrativeSynthesisOutput>;
}

export const CHAT_NARRATIVE_SYNTHESIZER = Symbol('CHAT_NARRATIVE_SYNTHESIZER');

