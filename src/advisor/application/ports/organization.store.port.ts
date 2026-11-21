import { Organization } from '../../domain/entities';

export interface OrganizationStorePort {
	/**
	 * Persiste a organização; o store gera o id. Um `ownerUserId` já usado por
	 * outra organização lança `DuplicateOrganizationOwnerError`.
	 */
	create(org: Omit<Organization, 'id'>): Promise<Organization>;
	findById(id: string): Promise<Organization | null>;
	/** Remove a organização (compensação de uma criação incompleta). */
	delete(id: string): Promise<void>;
}
