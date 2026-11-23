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
	/**
	 * Ids das organizações em ordem crescente, por páginas (o job diário
	 * percorre todas). `cursor` opaco; inválido lança `InvalidCursorError`.
	 * `limit` é limitado a 1..1000.
	 */
	listIds(
		cursor: string | undefined,
		limit: number
	): Promise<{ ids: string[]; nextCursor: string | null }>;
}
