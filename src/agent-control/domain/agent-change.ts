import { AgentDefinition, isLocked } from './agent-definition';
import { AgentControl, AgentControlSnapshot } from './agent-control.types';

/** Pausa do painel: só a duração aprovada no ADR-005, nunca data livre. */
export const AGENT_PAUSE_MS = 2 * 60 * 60 * 1000;

export const REASON_MIN_LENGTH = 10;
export const REASON_MAX_LENGTH = 300;

export interface AgentChangeInput {
	enabled?: boolean;
	/** `two_hours` pausa; `none` encerra a pausa. */
	pause?: 'two_hours' | 'none';
	/** Campos a mudar; os outros ficam como estão. */
	config?: Record<string, unknown>;
	reason?: string | null;
}

export type AgentChangeError =
	| { code: 'locked' }
	| { code: 'no_change' }
	| { code: 'not_configurable' }
	| { code: 'invalid_config'; issues: string[] }
	| { code: 'reason_required' }
	| { code: 'reason_too_long' };

export type AgentChangeResult =
	| { ok: true; next: AgentControlSnapshot; reasonRequired: boolean }
	| { ok: false; error: AgentChangeError };

export function snapshotOf(control: AgentControl): AgentControlSnapshot {
	return {
		enabled: control.enabled,
		config: control.config,
		pausedUntil: control.pausedUntil,
	};
}

/**
 * Igualdade de configuração campo a campo, sem depender da ordem das chaves:
 * o documento do banco e o objeto que o esquema devolve podem vir em ordens
 * diferentes, e isso não é mudança.
 */
export function sameConfig(
	a: Record<string, unknown> | null | undefined,
	b: Record<string, unknown> | null | undefined
): boolean {
	const left = a ?? {};
	const right = b ?? {};
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) {
		if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false;
	}
	return true;
}

function sameSnapshot(
	a: AgentControlSnapshot,
	b: AgentControlSnapshot
): boolean {
	return (
		a.enabled === b.enabled &&
		(a.pausedUntil?.getTime() ?? null) === (b.pausedUntil?.getTime() ?? null) &&
		sameConfig(a.config, b.config)
	);
}

/**
 * Aplica uma mudança pedida no painel ao estado atual (ADR-005, seções 4 e
 * 8). Pura: valida e devolve o próximo estado, sem gravar nada.
 *
 * Motivo é obrigatório para desligar, pausar e configurar — o que tira um
 * agente do ar ou muda o que ele faz. Ligar não pede motivo.
 */
export function planAgentChange(
	definition: AgentDefinition,
	current: AgentControl,
	input: AgentChangeInput,
	now: Date
): AgentChangeResult {
	if (isLocked(definition)) {
		return { ok: false, error: { code: 'locked' } };
	}

	const before = snapshotOf(current);
	let config = current.config;
	if (input.config !== undefined) {
		if (!definition.configSchema) {
			return { ok: false, error: { code: 'not_configurable' } };
		}
		const parsed = definition.configSchema.safeParse({
			...current.config,
			...input.config,
		});
		if (!parsed.success) {
			return {
				ok: false,
				error: {
					code: 'invalid_config',
					issues: parsed.error.issues.map(
						(issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`
					),
				},
			};
		}
		config = parsed.data;
	}

	let pausedUntil = before.pausedUntil;
	if (input.pause === 'two_hours') {
		pausedUntil = new Date(now.getTime() + AGENT_PAUSE_MS);
	} else if (input.pause === 'none') {
		pausedUntil = null;
	}

	const next: AgentControlSnapshot = {
		enabled: input.enabled ?? before.enabled,
		config,
		pausedUntil,
	};

	if (sameSnapshot(before, next)) {
		return { ok: false, error: { code: 'no_change' } };
	}

	const turnsOff = before.enabled && !next.enabled;
	const reasonRequired =
		turnsOff ||
		input.pause === 'two_hours' ||
		!sameConfig(before.config, next.config);

	const reason = (input.reason ?? '').trim();
	if (reason.length > REASON_MAX_LENGTH) {
		return { ok: false, error: { code: 'reason_too_long' } };
	}
	if (reasonRequired && reason.length < REASON_MIN_LENGTH) {
		return { ok: false, error: { code: 'reason_required' } };
	}

	return { ok: true, next, reasonRequired };
}
