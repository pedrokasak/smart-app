import { AgentControlSync } from 'src/agent-control/application/ports/agent-control-sync.port';

/** Sem Redis (fila desligada, teste): vale só a recarga de 30 s. */
export class NoopAgentControlSync implements AgentControlSync {
	async publishChanged(): Promise<void> {}
	subscribe(): void {}
	async close(): Promise<void> {}
}
