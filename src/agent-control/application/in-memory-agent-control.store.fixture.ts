import {
	AgentControl,
	AgentControlChange,
	AgentControlSnapshot,
} from 'src/agent-control/domain/agent-control.types';
import { AgentControlStore } from './ports/agent-control-store.port';

/** Store em memória para os testes do controle de agentes. */
export class InMemoryAgentControlStore implements AgentControlStore {
	readonly controls = new Map<string, AgentControl>();
	readonly changes: AgentControlChange[] = [];
	failReads = false;

	async findAll(): Promise<AgentControl[]> {
		if (this.failReads) throw new Error('mongo fora');
		return [...this.controls.values()].map((control) => ({ ...control }));
	}

	async findOne(agentId: string): Promise<AgentControl | null> {
		const control = this.controls.get(agentId);
		return control ? { ...control } : null;
	}

	async insertIfMissing(control: AgentControl): Promise<void> {
		if (!this.controls.has(control.agentId)) {
			this.controls.set(control.agentId, { ...control });
		}
	}

	async updateIfVersion(
		agentId: string,
		expectedVersion: number,
		next: AgentControlSnapshot & {
			updatedBy: string;
			updatedAt: Date;
			reason: string | null;
		}
	): Promise<AgentControl | null> {
		const current = this.controls.get(agentId);
		if (!current || current.version !== expectedVersion) return null;
		const saved = { ...current, ...next, version: current.version + 1 };
		this.controls.set(agentId, saved);
		return { ...saved };
	}

	async appendChange(change: AgentControlChange): Promise<void> {
		this.changes.push(change);
	}

	async listChanges(
		agentId: string | null,
		limit: number
	): Promise<AgentControlChange[]> {
		return this.changes
			.filter((change) => !agentId || change.agentId === agentId)
			.slice(-limit)
			.reverse();
	}
}
