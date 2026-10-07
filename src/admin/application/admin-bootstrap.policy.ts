import { INITIAL_ADMIN_EMAIL } from '../constants/admin.constants';

export const ADMIN_BOOTSTRAP_EMAIL_ENV = 'ADMIN_BOOTSTRAP_EMAIL';

function normalize(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * E-mail promovido a admin sem intervenção de outro admin. `ADMIN_BOOTSTRAP_EMAIL`
 * permite trocar o dono sem deploy; o fallback na constante mantém o ambiente
 * atual funcionando até a variável ser definida (TRA-184).
 */
export function bootstrapAdminEmail(
	env: NodeJS.ProcessEnv = process.env
): string {
	const configured = env[ADMIN_BOOTSTRAP_EMAIL_ENV]?.trim();
	return normalize(configured || INITIAL_ADMIN_EMAIL);
}

export function isBootstrapAdminEmail(
	email: string | undefined | null,
	env: NodeJS.ProcessEnv = process.env
): boolean {
	return !!email && normalize(email) === bootstrapAdminEmail(env);
}

/**
 * Só vira admin quem provou ser dono do e-mail. O cadastro por senha não
 * verifica e-mail: sem esta checagem, quem cadastrasse o e-mail do dono antes
 * dele (banco novo, ambiente novo) viraria admin.
 */
export function canBootstrapAdmin(
	user: { email: string; isEmailVerified?: boolean },
	env: NodeJS.ProcessEnv = process.env
): boolean {
	return (
		user.isEmailVerified === true && isBootstrapAdminEmail(user.email, env)
	);
}
