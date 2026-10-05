/** Uma resposta do chat a avaliar (TRA-242). Sem `userId`: o id é opaco. */
export interface AiEvalItem {
	id: string;
	route: 'regex' | 'tool_calling';
	intent: string;
	question: string;
	answer: string;
}

/** Notas agregadas de uma rota ou intenção. */
export interface AiEvalSummary {
	count: number;
	judged: number;
	fidelity: number | null;
	numeric_hallucination_rate: number | null;
	recommendation_rate: number | null;
	usefulness: number | null;
	level_fit: number | null;
	disclaimer_rate: number | null;
}

/** O que o trackerr-ia devolve: só agregados, nenhum texto. */
export interface AiEvalRunReport {
	rubric_version: string;
	judge_provider: string | null;
	prompt_fingerprint: string;
	totals: Record<string, number>;
	by_route: Record<string, AiEvalSummary>;
	by_intent: Record<string, AiEvalSummary>;
	guard: Record<string, number | null>;
}

/**
 * Quem avalia (TRA-242): o trackerr-ia, com checagens determinísticas e
 * um juiz LLM diferente do gerador. Ele junta a amostra do RAG da própria
 * auditoria. Lança quando o serviço falha.
 */
export interface AiEvalRunnerPort {
	run(input: {
		items: AiEvalItem[];
		windowDays: number;
		maxRagSamples: number;
	}): Promise<AiEvalRunReport>;
}

export const AI_EVAL_RUNNER = Symbol('AI_EVAL_RUNNER');
