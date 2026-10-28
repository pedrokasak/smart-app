import type { ZodType } from 'zod';

/**
 * Definição de um agente (ADR-005, seção 4).
 *
 * Vive no código, não no banco: criar ou mudar um agente é PR, porque um
 * agente é prompt, guarda e etapas — executar configuração como programa
 * abriria uma porta que o painel não deve ter. O painel só liga, desliga,
 * pausa e ajusta o que `configSchema` permite.
 */
export type AgentKind = 'ai_agent' | 'ai_capability' | 'data_job';

/**
 * `locked`: crítico (cobrança, snapshots, auditoria, LGPD). Aparece na lista,
 * sem interruptor, e só o ambiente pode pará-lo.
 */
export type AgentCriticality = 'toggleable' | 'locked';

export interface AgentScheduleOption {
	/** Valor gravado em `config.schedule` e mostrado no painel. */
	id: string;
	label: string;
	cron: string;
}

export interface AgentDefinition {
	id: string;
	name: string;
	kind: AgentKind;
	/** Rótulo da agenda atual, para a lista ("07h, 12h e 18h"). */
	schedule: string;
	criticality: AgentCriticality;
	/**
	 * Estado usado só quando não há documento em `agent_controls` (antes do
	 * seed ou com o banco fora). Agente de IA nasce `false`: na dúvida, não
	 * gastar.
	 */
	defaultEnabled: boolean;
	/**
	 * Variável que desliga o agente pelo ambiente. Só desliga: ver
	 * `envKills`. Antes do ADR-005 ela também ligava; esse papel passou para
	 * o painel, e o valor dela no primeiro boot vira o estado semeado.
	 */
	envKillSwitch?: string;
	/** Estado inicial no banco, derivado do ambiente de hoje (ADR-005, seção 5). */
	seedEnabled(env: NodeJS.ProcessEnv): boolean;
	/** Esquema estrito: campo fora dele é recusado, e segredo nunca é campo. */
	configSchema?: ZodType<Record<string, unknown>>;
	seedConfig?(env: NodeJS.ProcessEnv): Record<string, unknown>;
	/** Horários aceitos no painel, sempre lista fechada, nunca cron livre. */
	scheduleOptions?: AgentScheduleOption[];
	/** Nome do `@Cron` no `SchedulerRegistry`, para trocar o horário em runtime. */
	cronName?: string;
	timeZone?: string;
	/** Tela de detalhe que já existe no admin, quando houver. */
	detailRoute?: string;
}

export function isLocked(definition: AgentDefinition): boolean {
	return definition.criticality === 'locked';
}

export function isAi(definition: AgentDefinition): boolean {
	return definition.kind !== 'data_job';
}
