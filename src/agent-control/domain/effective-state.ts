import { AgentDefinition, isLocked } from './agent-definition';
import { AgentControl, EffectiveAgentState } from './agent-control.types';
import { envKills, killAllActive } from './env-switch';

/**
 * Estado efetivo de um agente (ADR-005, seção 5), em ordem de precedência:
 *
 * 1. Crítico: sempre ligado. Nem o kill switch global o para — desligar
 *    snapshots ou cobrança tem que ser decisão explícita no ambiente do
 *    próprio job, fora deste registro.
 * 2. `AGENTS_KILL_ALL=true`: desligado.
 * 3. Kill switch do agente com valor que não seja "true": desligado.
 * 4. Pausa no futuro: desligado, volta sozinho.
 * 5. Documento no banco: vale o painel.
 * 6. Sem documento: padrão da definição.
 *
 * Função pura: recebe o relógio, não lê ambiente global nem banco.
 */
export function resolveEffectiveState(
	definition: AgentDefinition,
	control: AgentControl | null,
	env: NodeJS.ProcessEnv,
	now: Date
): EffectiveAgentState {
	if (isLocked(definition)) {
		return { enabled: true, source: 'locked', pausedUntil: null };
	}
	if (killAllActive(env)) {
		return { enabled: false, source: 'kill_all', pausedUntil: null };
	}
	if (definition.envKillSwitch && envKills(env[definition.envKillSwitch])) {
		return { enabled: false, source: 'env', pausedUntil: null };
	}
	if (control?.pausedUntil && control.pausedUntil.getTime() > now.getTime()) {
		return {
			enabled: false,
			source: 'paused',
			pausedUntil: control.pausedUntil,
		};
	}
	if (control) {
		return { enabled: control.enabled, source: 'panel', pausedUntil: null };
	}
	return {
		enabled: definition.defaultEnabled,
		source: 'default',
		pausedUntil: null,
	};
}
