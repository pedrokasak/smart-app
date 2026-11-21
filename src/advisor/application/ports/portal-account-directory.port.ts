export const ADVISOR_PORTAL_ACCOUNT_DIRECTORY = Symbol(
	'ADVISOR_PORTAL_ACCOUNT_DIRECTORY'
);

/** Contas B2C vistas pela liberação do portal, sem o model de usuário. */
export interface PortalAccountDirectoryPort {
	/** Id da conta dona do e-mail (já normalizado). Null se não existe. */
	findUserIdByEmail(email: string): Promise<string | null>;

	/** E-mail de cada conta que existe; as que não existem ficam fora. */
	findEmails(userIds: string[]): Promise<Map<string, string>>;
}
