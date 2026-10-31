import {
	AgentRun,
	AgentRunSummary,
	COST_WINDOW_DAYS,
	ERRORS_WINDOW_DAYS,
} from './agent-run.types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resume as rodadas dos últimos 30 dias por agente. Pura: recebe o relógio.
 *
 * - Última execução: a rodada que terminou por último, inclusive a pulada.
 * - Erros em 7 dias: soma dos erros isolados e uma rodada que caiu inteira
 *   conta pelo menos um, mesmo sem contagem própria.
 * - Custo em 30 dias: soma só o que algum agente informou; `null` quando
 *   ninguém informou, para o painel não mostrar R$ 0,00 como se fosse dado.
 */
export function summarizeRuns(
	runs: AgentRun[],
	now: Date
): Map<string, AgentRunSummary> {
	const errorsSince = now.getTime() - ERRORS_WINDOW_DAYS * DAY_MS;
	const costSince = now.getTime() - COST_WINDOW_DAYS * DAY_MS;
	const summaries = new Map<string, AgentRunSummary>();

	for (const run of runs) {
		const finished = run.finishedAt.getTime();
		if (finished < costSince) continue;

		const summary = summaries.get(run.agentId) ?? {
			agentId: run.agentId,
			lastRun: null,
			errors7d: 0,
			tokens30d: 0,
			costBrl30d: null,
		};

		if (!summary.lastRun || finished > summary.lastRun.at.getTime()) {
			summary.lastRun = {
				at: run.finishedAt,
				status: run.status,
				items: run.items,
				durationMs: Math.max(0, finished - run.startedAt.getTime()),
				error: run.error ?? null,
			};
		}
		if (finished >= errorsSince) {
			summary.errors7d +=
				run.status === 'failed' ? Math.max(run.errors, 1) : run.errors;
		}
		summary.tokens30d += run.tokens;
		if (run.costBrl !== null) {
			summary.costBrl30d = (summary.costBrl30d ?? 0) + run.costBrl;
		}
		summaries.set(run.agentId, summary);
	}

	return summaries;
}
