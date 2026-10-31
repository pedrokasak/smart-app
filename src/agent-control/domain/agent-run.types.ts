/**
 * Uma rodada de um agente (`agent_runs`, ADR-005, fase A3). Alimenta
 * "Última execução", "Erros 7d" e "Custo 30d" da tela Agentes.
 *
 * `skipped_disabled` também é registrada: mostra que o cron disparou e o
 * agente respeitou o estado do painel, em vez de parecer que nada rodou.
 */
export type AgentRunStatus = 'ok' | 'partial' | 'failed' | 'skipped_disabled';

export interface AgentRun {
	agentId: string;
	startedAt: Date;
	finishedAt: Date;
	status: AgentRunStatus;
	/** Itens tratados, quando o agente informa. */
	items: number;
	/** Falhas isoladas dentro de uma rodada que terminou. */
	errors: number;
	tokens: number;
	/** `null` quando nenhum agente informou custo: o painel mostra "—". */
	costBrl: number | null;
	/** Mensagem curta do erro que derrubou a rodada, sem dado pessoal. */
	error: string | null;
}

/** O que um agente informa ao fim de uma rodada, de qualquer ponto dela. */
export interface AgentRunReport {
	items?: number;
	errors?: number;
	tokens?: number;
	costBrl?: number;
}

export interface AgentRunSummary {
	agentId: string;
	lastRun: {
		at: Date;
		status: AgentRunStatus;
		items: number;
		durationMs: number;
		/** Mensagem curta se a rodada caiu; o painel mostra ao passar o mouse. */
		error: string | null;
	} | null;
	errors7d: number;
	tokens30d: number;
	costBrl30d: number | null;
}

export const ERRORS_WINDOW_DAYS = 7;
export const COST_WINDOW_DAYS = 30;
export const RUN_RETENTION_DAYS = 180;
export const RUN_ERROR_MAX_CHARS = 300;
