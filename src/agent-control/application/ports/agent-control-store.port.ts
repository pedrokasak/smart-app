import {
	AgentControl,
	AgentControlChange,
	AgentControlSnapshot,
} from 'src/agent-control/domain/agent-control.types';

/**
 * Persistência do controle de agentes (ADR-005, seção 4). O domínio não
 * conhece Mongoose; o adaptador é o único que sabe onde isto mora.
 */
export interface AgentControlStore {
	findAll(): Promise<AgentControl[]>;
	findOne(agentId: string): Promise<AgentControl | null>;
	/** Grava só se não existir: duas instâncias subindo juntas não se pisam. */
	insertIfMissing(control: AgentControl): Promise<void>;
	/**
	 * Grava só se a versão ainda for `expectedVersion`. `null` quando outra
	 * mudança chegou antes: quem chamou devolve 409 e o painel recarrega.
	 */
	updateIfVersion(
		agentId: string,
		expectedVersion: number,
		next: AgentControlSnapshot & {
			updatedBy: string;
			updatedAt: Date;
			reason: string | null;
		}
	): Promise<AgentControl | null>;
	/** Histórico só de inclusão. */
	appendChange(change: AgentControlChange): Promise<void>;
	listChanges(
		agentId: string | null,
		limit: number
	): Promise<AgentControlChange[]>;
}

export const AGENT_CONTROL_STORE = Symbol('AGENT_CONTROL_STORE');
