/**
 * Liberação do portal do assessor pelo admin no piloto (P3a, U6). Separada
 * da assinatura B2C: dar ou tirar a liberação nunca muda o plano do usuário.
 * No máximo uma liberação ativa (sem `revokedAt`) por usuário.
 */
export interface PortalGrant {
	id: string;
	userId: string;
	/** Admin que liberou. */
	grantedBy: string;
	grantedAt: Date;
	revokedAt?: Date;
}

/** Linha da listagem do admin: o e-mail sai só mascarado. */
export interface PortalGrantListItem {
	userId: string;
	/** Null quando a conta não existe mais. */
	emailMasked: string | null;
	grantedAt: Date;
}
