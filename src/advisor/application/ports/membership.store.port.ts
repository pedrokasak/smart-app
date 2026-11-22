import { Membership } from '../../domain/entities';
import { OrgRole } from '../../domain/enums';

export interface MembershipStorePort {
	/**
	 * Persiste o vínculo usuário-organização; o store gera o id. Par
	 * (userId, orgId) repetido lança `DuplicateMembershipError`.
	 */
	create(membership: Omit<Membership, 'id'>): Promise<Membership>;
	/** Ordem estável: `createdAt` crescente, desempate por id. */
	findByUser(userId: string): Promise<Membership[]>;
	findByUserAndOrg(userId: string, orgId: string): Promise<Membership | null>;
	/** Remove o vínculo; false se não existia. */
	delete(userId: string, orgId: string): Promise<boolean>;
	/** Troca o papel; null se o vínculo não existe. */
	setRole(
		userId: string,
		orgId: string,
		role: OrgRole
	): Promise<Membership | null>;
	/**
	 * Vínculos da organização, `createdAt` crescente com desempate por id,
	 * até 200.
	 */
	listByOrg(orgId: string): Promise<Membership[]>;
	/** LGPD: remove os vínculos do usuário em todas as organizações. */
	deleteAllForUser(userId: string): Promise<number>;
}
