/**
 * Estado gravado de um agente (`agent_controls`, ADR-005, seção 4). Só para
 * agentes `toggleable`: crítico não tem documento.
 */
export interface AgentControl {
	agentId: string;
	enabled: boolean;
	config: Record<string, unknown>;
	/** Pausa com volta automática. `null` quando não há pausa. */
	pausedUntil: Date | null;
	/** Controle otimista: duas abas salvando ao mesmo tempo não se sobrescrevem. */
	version: number;
	/** `userRef` (HMAC) de quem mudou por último; `seed` no primeiro boot. */
	updatedBy: string;
	updatedAt: Date;
	reason: string | null;
}

/** Por que o agente está no estado em que está — o painel mostra isto. */
export type EffectiveStateSource =
	| 'kill_all'
	| 'env'
	| 'locked'
	| 'paused'
	| 'panel'
	| 'default';

export interface EffectiveAgentState {
	enabled: boolean;
	source: EffectiveStateSource;
	pausedUntil: Date | null;
}

/** Uma linha do histórico (`agent_control_changes`), só inclusão. */
export interface AgentControlChange {
	agentId: string;
	fromVersion: number;
	toVersion: number;
	before: AgentControlSnapshot;
	after: AgentControlSnapshot;
	/** HMAC do id do admin: o histórico não guarda dado pessoal. */
	actorRef: string;
	reason: string | null;
	ip: string | null;
	at: Date;
	/** Evento desta mudança na trilha encadeada (ADR-005, fase A4). */
	auditEventId?: string;
}

export interface AgentControlSnapshot {
	enabled: boolean;
	config: Record<string, unknown>;
	pausedUntil: Date | null;
}
