import 'reflect-metadata';
import { findAgentDefinition } from 'src/agent-control/domain/agent-catalog';
import { AgentGate } from './agent-gate.port';

/**
 * Faz do método de um agendador uma rodada controlada (ADR-005, fase A3):
 * consulta o estado do painel antes, registra `skipped_disabled`, `ok`,
 * `partial` ou `failed` depois, e deixa o erro subir como subia.
 *
 * Fica logo abaixo do `@Cron`. Usa o `agentGate` que o agendador já injeta:
 * sem ele (teste que monta o agendador à mão), o método roda como antes.
 *
 *   @Cron('0 4 * * *')
 *   @AgentRun('investor-profile')
 *   async recalculateDaily() { ... }
 */
export function AgentRun(agentId: string): MethodDecorator {
	// Typo no id falha no boot, ao carregar a classe, e não em silêncio no
	// primeiro disparo do cron.
	if (!findAgentDefinition(agentId)) {
		throw new Error(`@AgentRun: agente desconhecido: ${agentId}`);
	}
	return (_target, _key, descriptor: PropertyDescriptor) => {
		const original = descriptor.value as (
			...args: unknown[]
		) => Promise<unknown>;

		const wrapped = async function (
			this: { agentGate?: AgentGate },
			...args: unknown[]
		) {
			const gate = this.agentGate;
			if (!gate) return original.apply(this, args);
			return gate.run(agentId, () => original.apply(this, args));
		};

		// Metadados de outros decoradores (`@Cron` guarda o horário no próprio
		// método): sem copiar, o agendador não acharia o job no método novo.
		for (const key of Reflect.getMetadataKeys(original)) {
			Reflect.defineMetadata(key, Reflect.getMetadata(key, original), wrapped);
		}
		Object.defineProperty(wrapped, 'name', { value: original.name });
		descriptor.value = wrapped;
	};
}
