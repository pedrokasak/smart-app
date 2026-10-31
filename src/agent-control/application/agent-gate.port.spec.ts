import {
	withAgentPanel,
	RI_WATCH_DEFAULTS,
} from 'src/ri-intelligence/watch/application/ri-watch.config';
import {
	AgentGate,
	agentAllows,
	panelEnabled,
	withPanelSwitch,
} from './agent-gate.port';

function gate(
	enabled: Record<string, boolean | null>,
	config: Record<string, Record<string, unknown>> = {}
): AgentGate {
	return {
		isEnabled: async (id) => enabled[id] ?? false,
		config: async (id) => (config[id] as never) ?? null,
		peekConfig: (id) => (config[id] as never) ?? null,
		peekEnabled: (id) => (id in enabled ? enabled[id] : null),
		run: async (_id, fn) => fn(),
	};
}

describe('porta do controle de agentes', () => {
	it('sem porta, vale o comportamento de antes do ADR-005', async () => {
		await expect(agentAllows(undefined, 'ai-eval', false)).resolves.toBe(false);
		await expect(agentAllows(undefined, 'macro-series')).resolves.toBe(true);
		expect(panelEnabled(undefined, 'ai-eval', true)).toBe(true);
	});

	it('antes do primeiro carregamento, vale o ambiente', () => {
		expect(panelEnabled(gate({ 'ai-eval': null }), 'ai-eval', true)).toBe(true);
	});

	it('o getter de enabled segue o painel a cada leitura', () => {
		const state = { 'ai-eval': true };
		const config = withPanelSwitch(
			{ enabled: false, other: 1 },
			gate(state),
			'ai-eval'
		);
		expect(config.enabled).toBe(true);
		state['ai-eval'] = false;
		expect(config.enabled).toBe(false);
		expect(config.other).toBe(1);
	});

	it('etapas do vigia de RI seguem o painel, com a variável como kill switch', () => {
		const config = withAgentPanel(
			{ ...RI_WATCH_DEFAULTS },
			gate(
				{ 'ri-watch': true },
				{ 'ri-watch': { enet: true, fii: true, notify: true, index: false } }
			),
			{ RI_WATCH_NOTIFY_ENABLED: 'false' }
		);

		expect(config.enabled).toBe(true);
		expect(config.fiiEnabled).toBe(true);
		expect(config.indexEnabled).toBe(false);
		expect(config.notifyEnabled).toBe(false);
		expect(config.dailyFeedEnabled).toBe(true);
		expect(config.lookbackDays).toBe(RI_WATCH_DEFAULTS.lookbackDays);
	});

	it('sem painel carregado, as etapas do vigia valem o ambiente', () => {
		const config = withAgentPanel(
			{ ...RI_WATCH_DEFAULTS, notifyEnabled: true },
			gate({})
		);
		expect(config.notifyEnabled).toBe(true);
		expect(config.fiiEnabled).toBe(false);
	});
});
