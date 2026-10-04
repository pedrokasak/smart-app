import { ChatOrchestratorIntent } from 'src/ai/orchestration/chat-orchestrator.types';
import { ChatTool } from './chat-tool-catalog';

/** Uma ferramenta escolhida pelo LLM, já conferida contra o catálogo. */
export interface ChatPlannedCall {
	intent: ChatOrchestratorIntent;
	tickers: string[];
}

export interface ChatToolPlan {
	calls: ChatPlannedCall[];
	provider: string | null;
	inputTokens: number;
	outputTokens: number;
	/** 'no_tool' ou 'not_supported' quando não há chamada. */
	reason: string | null;
}

/**
 * Quem escolhe as ferramentas (TRA-241). Hoje é o trackerr-ia, com tool
 * calling de passo único; a porta deixa a troca de runtime (LangGraph, por
 * exemplo) longe do roteador. Lança quando o serviço falha: o roteador cai
 * na resposta do regex.
 */
export interface ChatToolPlannerPort {
	plan(input: {
		question: string;
		tools: readonly ChatTool[];
		maxCalls: number;
	}): Promise<ChatToolPlan>;
}

export const CHAT_TOOL_PLANNER = Symbol('CHAT_TOOL_PLANNER');
