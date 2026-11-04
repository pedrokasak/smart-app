import { Membership } from '../../domain/entities';

export interface MembershipStorePort {
	/** Persiste o vínculo usuário-organização; o store gera o id. */
	create(membership: Omit<Membership, 'id'>): Promise<Membership>;
	findByUser(userId: string): Promise<Membership[]>;
	findByUserAndOrg(userId: string, orgId: string): Promise<Membership | null>;
}
