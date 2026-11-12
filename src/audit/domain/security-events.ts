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
	SessionRevoked: 'security.session.revoked',
	SocialAccountLinked: 'security.social_account.linked',
	SessionReuseDetected: 'security.session.reuse_detected',
	BiometricEnrolled: 'security.biometric.enrolled',
	BiometricRevoked: 'security.biometric.revoked',
	RoleChanged: 'security.role.changed',
	ManualGrantCreated: 'billing.manual_grant.created',
	// Consentimento da voz do Copiloto (ADR-007, decisão 10).
	VoiceConsentAccepted: 'privacy.voice_consent.accepted',
	VoiceConsentRevoked: 'privacy.voice_consent.revoked',
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
	[SECURITY_EVENT.SessionRevoked]: 'Sessão encerrada',
	[SECURITY_EVENT.SocialAccountLinked]: 'Login social vinculado',
	[SECURITY_EVENT.SessionReuseDetected]: 'Reuso de token de sessão',
	[SECURITY_EVENT.BiometricEnrolled]: 'Biometria ligada',
	[SECURITY_EVENT.BiometricRevoked]: 'Biometria desligada',
	[SECURITY_EVENT.RoleChanged]: 'Papel alterado',
	[SECURITY_EVENT.ManualGrantCreated]: 'Concessão manual',
	'agent.control.changed': 'Agente alterado',
	[SECURITY_EVENT.VoiceConsentAccepted]: 'Voz do Copiloto aceita',
	[SECURITY_EVENT.VoiceConsentRevoked]: 'Voz do Copiloto revogada',
};
