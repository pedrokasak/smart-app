import z from 'zod';

/**
 * Avaliação semanal das respostas de IA (TRA-242). Desligada por padrão:
 * cada rodada chama o juiz LLM uma vez por amostra. Liga com
 * `AI_EVAL_ENABLED=true` depois do trackerr-ia com `/api/evals/run` no ar.
 */
export interface AiEvalConfig {
	enabled: boolean;
	/** Respostas do chat por rodada. */
	chatSamples: number;
	/** Respostas do RAG por rodada (amostradas no trackerr-ia). */
	ragSamples: number;
	windowDays: number;
	/** Relatórios guardados (retenção). */
	keepReports: number;
}

export const AI_EVAL_CONFIG = Symbol('AI_EVAL_CONFIG');

export const AI_EVAL_DEFAULTS: AiEvalConfig = {
	enabled: false,
	chatSamples: 60,
	ragSamples: 30,
	windowDays: 7,
	keepReports: 26,
};

function field<T>(parser: z.ZodType<T>, value: unknown): T | undefined {
	if (value === undefined || value === '') return undefined;
	const parsed = parser.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}

export function loadAiEvalConfig(
	env: NodeJS.ProcessEnv = process.env
): AiEvalConfig {
	return {
		enabled: env.AI_EVAL_ENABLED === 'true',
		chatSamples:
			field(
				z.coerce.number().int().min(0).max(120),
				env.AI_EVAL_CHAT_SAMPLES
			) ?? AI_EVAL_DEFAULTS.chatSamples,
		ragSamples:
			field(z.coerce.number().int().min(0).max(100), env.AI_EVAL_RAG_SAMPLES) ??
			AI_EVAL_DEFAULTS.ragSamples,
		windowDays: AI_EVAL_DEFAULTS.windowDays,
		keepReports: AI_EVAL_DEFAULTS.keepReports,
	};
}
