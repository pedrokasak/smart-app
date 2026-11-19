import { AgentDefinition } from 'src/agent-control/domain/agent-definition';

/**
 * Reautenticação do admin antes de mudar um agente (ADR-005, seção 8): o
 * código TOTP do autenticador, com a mesma política de tentativas do login.
 * Sessão roubada sem o celular não liga nem desliga nada.
 */
export interface StepUpVerifier {
	/** Lança quando o código não confere, o 2FA não está ativo ou bloqueou. */
	verify(userId: string, code: string): Promise<void>;
}

export const STEP_UP_VERIFIER = Symbol('STEP_UP_VERIFIER');

export interface AgentControlChangedNotice {
	agentName: string;
	change: string;
	reason: string | null;
	actorUserId: string;
	at: Date;
}

/** E-mail aos outros admins a cada mudança (decisão de 26/10/2026). */
export interface AgentChangeNotifier {
	notify(notice: AgentControlChangedNotice): Promise<void>;
}

export const AGENT_CHANGE_NOTIFIER = Symbol('AGENT_CHANGE_NOTIFIER');

/**
 * Aplica o horário escolhido no painel ao `@Cron` em execução (ADR-005,
 * seção 7). Cada instância aplica o seu ao recarregar o estado.
 */
export interface AgentScheduleApplier {
	apply(definition: AgentDefinition, cron: string): void;
}

export const AGENT_SCHEDULE_APPLIER = Symbol('AGENT_SCHEDULE_APPLIER');
