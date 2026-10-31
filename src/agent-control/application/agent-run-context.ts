import { AsyncLocalStorage } from 'async_hooks';
import { AgentRunReport } from 'src/agent-control/domain/agent-run.types';

/** O que a rodada somou até aqui; `costBrl` fica `null` até alguém informar. */
export interface CollectedReport {
	items: number;
	errors: number;
	tokens: number;
	costBrl: number | null;
}

/**
 * Relatório da rodada em andamento. O agente chama `reportAgentRun` de
 * qualquer ponto da rodada (sem receber nada por parâmetro) e a rodada
 * registrada leva a soma. Fora de uma rodada, não faz nada.
 */
const storage = new AsyncLocalStorage<CollectedReport>();

export function reportAgentRun(report: AgentRunReport): void {
	const current = storage.getStore();
	if (!current) return;
	current.items += report.items ?? 0;
	current.errors += report.errors ?? 0;
	current.tokens += report.tokens ?? 0;
	if (report.costBrl !== undefined) {
		current.costBrl = (current.costBrl ?? 0) + report.costBrl;
	}
}

export type CollectedRun<T> =
	| { kind: 'done'; value: T; report: CollectedReport }
	| { kind: 'threw'; error: unknown; report: CollectedReport };

/**
 * Roda `fn` coletando o relatório. Devolve o relatório também quando `fn`
 * lança: uma rodada que caiu no fim não pode apagar o que já tratou.
 */
export async function collectAgentReport<T>(
	fn: () => Promise<T>
): Promise<CollectedRun<T>> {
	const report: CollectedReport = {
		items: 0,
		errors: 0,
		tokens: 0,
		costBrl: null,
	};
	try {
		return { kind: 'done', value: await storage.run(report, fn), report };
	} catch (error) {
		return { kind: 'threw', error, report };
	}
}
