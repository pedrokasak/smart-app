import { AgentRun } from 'src/agent-control/domain/agent-run.types';

/** Persistência das rodadas (ADR-005, fase A3). Só inclusão e leitura por janela. */
export interface AgentRunStore {
	insert(run: AgentRun): Promise<void>;
	findSince(since: Date): Promise<AgentRun[]>;
}

export const AGENT_RUN_STORE = Symbol('AGENT_RUN_STORE');
