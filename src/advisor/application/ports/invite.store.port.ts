import { ClientInvite } from '../../domain/consent.entities';
import { InviteStatus } from '../../domain/enums';

export interface InviteStorePort {
	create(invite: Omit<ClientInvite, 'id' | 'createdAt'>): Promise<ClientInvite>;
	findByTokenHash(tokenHash: string): Promise<ClientInvite | null>;
	findById(orgId: string, id: string): Promise<ClientInvite | null>;
	/** Convites PENDING da organização para aquele e-mail. */
	findPendingByOrgAndEmail(
		orgId: string,
		email: string
	): Promise<ClientInvite[]>;
	/**
	 * Atômico: só muda se o status atual for PENDING. Devolve o convite
	 * atualizado (com `respondedAt = at`) ou null.
	 */
	transition(
		id: string,
		to: InviteStatus,
		at: Date
	): Promise<ClientInvite | null>;
	/**
	 * Atômico: só se PENDING e resendCount < max. Troca token e prazo,
	 * incrementa a contagem. Null caso contrário.
	 */
	rotateToken(
		id: string,
		tokenHash: string,
		expiresAt: Date,
		max: number
	): Promise<ClientInvite | null>;
	/** LGPD: apaga os convites do e-mail e devolve a contagem. */
	deleteByEmail(email: string): Promise<number>;
	/**
	 * LGPD: apaga os convites dessas relações (mesmo os aceitos com um e-mail
	 * antigo da conta) e devolve a contagem. Lista vazia => 0.
	 */
	deleteByRelationshipIds(relationshipIds: string[]): Promise<number>;
}
