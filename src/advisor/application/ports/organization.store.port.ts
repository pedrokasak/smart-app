import { Organization } from '../../domain/entities';

export interface OrganizationStorePort {
	/** Persiste a organização; o store gera o id. */
	create(org: Omit<Organization, 'id'>): Promise<Organization>;
	findById(id: string): Promise<Organization | null>;
}
