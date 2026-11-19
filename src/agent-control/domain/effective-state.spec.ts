import { AgentDefinition } from './agent-definition';
import { AgentControl } from './agent-control.types';
import { resolveEffectiveState } from './effective-state';

const now = new Date('2026-10-27T12:00:00Z');

const definition: AgentDefinition = {
	id: 'ri-watch',
	name: 'Vigia de RI',
	kind: 'ai_agent',
	schedule: '07h',
	criticality: 'toggleable',
	defaultEnabled: false,
	envKillSwitch: 'RI_WATCH_ENABLED',
	seedEnabled: () => false,
};

const locked: AgentDefinition = {
	...definition,
	id: 'cleanup',
	criticality: 'locked',
	envKillSwitch: undefined,
};

function control(overrides: Partial<AgentControl> = {}): AgentControl {
	return {
		agentId: 'ri-watch',
		enabled: true,
		config: {},
		pausedUntil: null,
		version: 1,
		updatedBy: 'seed',
		updatedAt: now,
		reason: null,
		...overrides,
	};
}

describe('resolveEffectiveState', () => {
	it('crítico fica ligado mesmo com o kill switch global', () => {
		expect(
			resolveEffectiveState(locked, null, { AGENTS_KILL_ALL: 'true' }, now)
		).toEqual({ enabled: true, source: 'locked', pausedUntil: null });
	});

	it('kill switch global desliga o que não é crítico', () => {
		expect(
			resolveEffectiveState(
				definition,
				control(),
				{ AGENTS_KILL_ALL: 'true' },
				now
			).source
		).toBe('kill_all');
	});

	it('kill switch do agente desliga com qualquer valor que não seja "true"', () => {
		for (const value of ['false', '0', 'off', 'False']) {
			const state = resolveEffectiveState(
				definition,
				control(),
				{ RI_WATCH_ENABLED: value },
				now
			);
			expect(state).toEqual({
				enabled: false,
				source: 'env',
				pausedUntil: null,
			});
		}
	});

	it('ambiente com "true" ou vazio não liga por cima do painel', () => {
		for (const value of ['true', '', undefined]) {
			const state = resolveEffectiveState(
				definition,
				control({ enabled: false }),
				{ RI_WATCH_ENABLED: value },
				now
			);
			expect(state).toEqual({
				enabled: false,
				source: 'panel',
				pausedUntil: null,
			});
		}
	});

	it('pausa no futuro desliga e informa até quando', () => {
		const pausedUntil = new Date(now.getTime() + 60_000);
		expect(
			resolveEffectiveState(definition, control({ pausedUntil }), {}, now)
		).toEqual({ enabled: false, source: 'paused', pausedUntil });
	});

	it('pausa vencida volta a valer o painel sozinha', () => {
		const pausedUntil = new Date(now.getTime() - 1);
		expect(
			resolveEffectiveState(definition, control({ pausedUntil }), {}, now)
		).toEqual({ enabled: true, source: 'panel', pausedUntil: null });
	});

	it('sem documento no banco vale o padrão da definição', () => {
		expect(resolveEffectiveState(definition, null, {}, now)).toEqual({
			enabled: false,
			source: 'default',
			pausedUntil: null,
		});
	});
});
