import { MemberInviteStatus } from '../../domain/enums';
import { MemberInvite } from '../../domain/team.entities';

export interface MemberInviteStorePort {
	/**
	 * Persiste o convite; o store gera id e `createdAt`. Um segundo convite
	 * PENDING para o mesmo e-mail na mesma organização lança
	 * `DuplicatePendingMemberInviteError`.
	 */
	create(invite: Omit<MemberInvite, 'id' | 'createdAt'>): Promise<MemberInvite>;
	findById(orgId: string, id: string): Promise<MemberInvite | null>;
	findByTokenHash(tokenHash: string): Promise<MemberInvite | null>;
	/** O convite PENDING ainda dentro do prazo (`expiresAt > now`), se houver. */
	findPendingByOrgAndEmail(
		orgId: string,
		email: string,
		now: Date
	): Promise<MemberInvite | null>;
	/**
	 * Convites PENDING da organização ainda dentro do prazo, mais recente
	 * primeiro, até 200.
	 */
	listPendingByOrg(orgId: string, now: Date): Promise<MemberInvite[]>;
	/**
	 * Atômico: só muda se o status atual for `from`. Devolve o convite
	 * atualizado (com `respondedAt = at`) ou null. A volta para PENDING
	 * (desfazer uma resposta) apaga `respondedAt`.
	 */
	transition(
		id: string,
		from: MemberInviteStatus,
		to: MemberInviteStatus,
		at: Date
	): Promise<MemberInvite | null>;
	/**
	 * Atômico: só se PENDING e `resendCount < max`. Troca token e prazo e
	 * incrementa `resendCount`. Null caso contrário (dois reenvios
	 * simultâneos no limite: só um passa).
	 */
	rotateToken(
		id: string,
		tokenHash: string,
		expiresAt: Date,
		max: number
	): Promise<MemberInvite | null>;
	/** Só para desfazer a criação quando o envio falha. */
	deleteById(id: string): Promise<void>;
	/** LGPD: apaga os convites PENDING desse e-mail em todas as organizações. */
	deletePendingByEmail(email: string): Promise<number>;
}
