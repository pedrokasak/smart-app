/**
 * Porta que cada agente consulta antes de rodar (ADR-005, seção 7). É a
 * única coisa que um agendador precisa saber do controle.
 */
export interface AgentGate {
	/** Estado efetivo agora: ambiente, pausa e painel já resolvidos. */
	isEnabled(agentId: string): Promise<boolean>;
	/** Configuração gravada no painel, ou `null` sem documento. */
	config<T extends Record<string, unknown>>(agentId: string): Promise<T | null>;
	/**
	 * Mesma configuração, síncrona, do último carregamento. Para quem lê a
	 * configuração num getter e não pode esperar (`ri-watch.config.ts`).
	 */
	peekConfig<T extends Record<string, unknown>>(agentId: string): T | null;
	/**
	 * Estado efetivo, síncrono, do último carregamento. `null` antes do
	 * primeiro carregamento: quem chama decide o que vale até lá.
	 */
	peekEnabled(agentId: string): boolean | null;
	/**
	 * Roda uma rodada do agente sob o controle (ADR-005, fase A3): se o estado
	 * efetivo for desligado, registra `skipped_disabled` e devolve `undefined`
	 * sem chamar `fn`; senão chama `fn`, mede e registra a rodada (ok, parcial
	 * ou falha, que sobe de novo). É o que `@AgentRun` usa.
	 */
	run<T>(agentId: string, fn: () => Promise<T>): Promise<T | undefined>;
}

export const AGENT_GATE = Symbol('AGENT_GATE');

/** Opção de injeção para quem aceita rodar sem o controle (teste montado à mão). */
export const OPTIONAL_AGENT_GATE = { token: AGENT_GATE, optional: true };

/**
 * Estado do painel para quem lê `enabled` de forma síncrona. Sem a porta, ou
 * antes do primeiro carregamento, vale `legacy` (o que o ambiente dizia antes
 * do ADR-005).
 */
export function panelEnabled(
	gate: AgentGate | undefined | null,
	agentId: string,
	legacy: boolean
): boolean {
	if (!gate) return legacy;
	return gate.peekEnabled(agentId) ?? legacy;
}

/**
 * Troca o `enabled` de um objeto de configuração lido do ambiente por um
 * getter que consulta o painel. Quem já lia `config.enabled` — agendador,
 * tela de status do admin — passa a seguir o painel sem mudar uma linha.
 */
export function withPanelSwitch<T extends { enabled: boolean }>(
	config: T,
	gate: AgentGate | undefined | null,
	agentId: string
): T {
	const legacy = config.enabled;
	return Object.defineProperty({ ...config }, 'enabled', {
		get: () => panelEnabled(gate, agentId, legacy),
		enumerable: true,
	});
}

/**
 * Pergunta à porta se o agente pode rodar. Sem a porta (teste que monta o
 * agendador à mão), vale o comportamento de antes do ADR-005, que o
 * chamador passa em `legacy`.
 */
export async function agentAllows(
	gate: AgentGate | undefined,
	agentId: string,
	legacy = true
): Promise<boolean> {
	return gate ? gate.isEnabled(agentId) : legacy;
}
