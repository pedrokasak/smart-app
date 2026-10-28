import z from 'zod';
import { AGENT_PAUSE_MS, planAgentChange } from './agent-change';
import { AgentDefinition } from './agent-definition';
import { AgentControl } from './agent-control.types';

const now = new Date('2026-10-27T12:00:00Z');

const definition: AgentDefinition = {
	id: 'ri-watch',
	name: 'Vigia de RI',
	kind: 'ai_agent',
	schedule: '07h',
	criticality: 'toggleable',
	defaultEnabled: false,
	seedEnabled: () => false,
	configSchema: z.object({ notify: z.boolean(), index: z.boolean() }).strict(),
};

const current: AgentControl = {
	agentId: 'ri-watch',
	enabled: true,
	config: { notify: true, index: false },
	pausedUntil: null,
	version: 3,
	updatedBy: 'seed',
	updatedAt: now,
	reason: null,
};

const reason = 'custo acima do previsto na semana';

describe('planAgentChange', () => {
	it('recusa mudar agente crítico', () => {
		expect(
			planAgentChange(
				{ ...definition, criticality: 'locked' },
				current,
				{ enabled: false, reason },
				now
			)
		).toEqual({ ok: false, error: { code: 'locked' } });
	});

	it('desligar exige motivo de pelo menos 10 caracteres', () => {
		expect(
			planAgentChange(definition, current, { enabled: false }, now)
		).toEqual({
			ok: false,
			error: { code: 'reason_required' },
		});
		expect(
			planAgentChange(
				definition,
				current,
				{ enabled: false, reason: 'curto' },
				now
			)
		).toEqual({ ok: false, error: { code: 'reason_required' } });
	});

	it('ligar não exige motivo', () => {
		const result = planAgentChange(
			definition,
			{ ...current, enabled: false },
			{ enabled: true },
			now
		);
		expect(result).toEqual({
			ok: true,
			next: { enabled: true, config: current.config, pausedUntil: null },
			reasonRequired: false,
		});
	});

	it('pausa por exatamente 2 horas, com motivo', () => {
		const result = planAgentChange(
			definition,
			current,
			{ pause: 'two_hours', reason },
			now
		);
		expect(result.ok && result.next.pausedUntil).toEqual(
			new Date(now.getTime() + AGENT_PAUSE_MS)
		);
	});

	it('mescla a configuração e valida pelo esquema estrito', () => {
		const result = planAgentChange(
			definition,
			current,
			{ config: { index: true }, reason },
			now
		);
		expect(result.ok && result.next.config).toEqual({
			notify: true,
			index: true,
		});
	});

	it('recusa campo fora do esquema, como uma chave de API', () => {
		const result = planAgentChange(
			definition,
			current,
			{ config: { apiKey: 'sk-123' }, reason },
			now
		);
		expect(result).toMatchObject({
			ok: false,
			error: { code: 'invalid_config' },
		});
	});

	it('recusa configurar agente sem esquema', () => {
		expect(
			planAgentChange(
				{ ...definition, configSchema: undefined },
				current,
				{ config: { notify: false }, reason },
				now
			)
		).toEqual({ ok: false, error: { code: 'not_configurable' } });
	});

	it('mudança que não muda nada é recusada', () => {
		expect(
			planAgentChange(definition, current, { enabled: true }, now)
		).toEqual({
			ok: false,
			error: { code: 'no_change' },
		});
	});

	it('ordem diferente das chaves na configuração não é mudança', () => {
		expect(
			planAgentChange(
				definition,
				{ ...current, enabled: false, config: { index: false, notify: true } },
				{ enabled: true, config: { notify: true } },
				now
			)
		).toEqual({
			ok: true,
			next: {
				enabled: true,
				config: { notify: true, index: false },
				pausedUntil: null,
			},
			reasonRequired: false,
		});
	});

	it('recusa motivo acima de 300 caracteres', () => {
		expect(
			planAgentChange(
				definition,
				current,
				{ enabled: false, reason: 'x'.repeat(301) },
				now
			)
		).toEqual({ ok: false, error: { code: 'reason_too_long' } });
	});
});
