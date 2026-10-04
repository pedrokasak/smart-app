/**
 * Roteador do chat com tool-calling (TRA-241). Desligado por padrão: cada
 * pergunta que o regex não resolve passa a custar uma chamada de LLM. Liga
 * com `CHAT_TOOL_ROUTER_ENABLED=true`, depois do trackerr-ia com
 * `/api/chat/plan` no ar.
 */
export interface ChatToolRouterConfig {
	enabled: boolean;
	/** Teto de ferramentas por pergunta. */
	maxCalls: number;
}

export const CHAT_TOOL_ROUTER_CONFIG = Symbol('CHAT_TOOL_ROUTER_CONFIG');

export const CHAT_TOOL_ROUTER_MAX_CALLS = 3;

export function loadChatToolRouterConfig(
	env: NodeJS.ProcessEnv = process.env
): ChatToolRouterConfig {
	return {
		enabled: env.CHAT_TOOL_ROUTER_ENABLED === 'true',
		maxCalls: CHAT_TOOL_ROUTER_MAX_CALLS,
	};
}
