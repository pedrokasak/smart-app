/**
 * Propagação imediata de uma mudança entre instâncias (ADR-005, seção 7.1).
 * Sem ela, cada instância ainda recarrega o estado a cada 30 s; com ela, a
 * mudança vale na hora. O transporte (Redis hoje) fica no adaptador.
 */
export interface AgentControlSync {
	/** Avisa as outras instâncias. Nunca lança: o aviso é um atalho, não a garantia. */
	publishChanged(agentId: string): Promise<void>;
	/** Chama `onChanged` quando outra instância mudou um agente. */
	subscribe(onChanged: (agentId: string) => void): void;
	close(): Promise<void>;
}

export const AGENT_CONTROL_SYNC = Symbol('AGENT_CONTROL_SYNC');
