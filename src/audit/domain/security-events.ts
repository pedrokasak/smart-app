/**
 * Tipos dos eventos de segurança e de administração que vão para a trilha
 * (ADR-004, seção 9.3). Convenção do projeto: `<contexto>.<agregado>.<fato>`.
 *
 * Nenhum leva e-mail, IP, senha, código ou segredo: o conteúdo é só o que
 * precisa para entender o que aconteceu.
 */
export const SECURITY_EVENT = {
	LoginSucceeded: 'security.login.succeeded',
	LoginFailed: 'security.login.failed',
	TwoFactorEnabled: 'security.two_factor.enabled',
	TwoFactorDisabled: 'security.two_factor.disabled',
	TwoFactorFailed: 'security.two_factor.failed',
	PasswordChanged: 'security.password.changed',
	RoleChanged: 'security.role.changed',
	ManualGrantCreated: 'billing.manual_grant.created',
} as const;

export type SecurityEventType =
	(typeof SECURITY_EVENT)[keyof typeof SECURITY_EVENT];

/** Rótulo em português de cada tipo, para a tela de auditoria. */
export const SECURITY_EVENT_LABELS: Record<string, string> = {
	[SECURITY_EVENT.LoginSucceeded]: 'Login',
	[SECURITY_EVENT.LoginFailed]: 'Login recusado',
	[SECURITY_EVENT.TwoFactorEnabled]: '2FA ativado',
	[SECURITY_EVENT.TwoFactorDisabled]: '2FA desativado',
	[SECURITY_EVENT.TwoFactorFailed]: 'Código 2FA recusado',
	[SECURITY_EVENT.PasswordChanged]: 'Senha alterada',
	[SECURITY_EVENT.RoleChanged]: 'Papel alterado',
	[SECURITY_EVENT.ManualGrantCreated]: 'Concessão manual',
	'agent.control.changed': 'Agente alterado',
};
