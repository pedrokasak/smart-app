import { ClientProfile } from '../../domain/entities';

export interface ClientProfileStorePort {
	/** Persiste o perfil do cliente; o store gera o id. */
	create(profile: Omit<ClientProfile, 'id'>): Promise<ClientProfile>;
	findById(id: string): Promise<ClientProfile | null>;
	/** Só os perfis daquela organização; ids de outra org ou inexistentes somem. */
	findByIds(orgId: string, ids: string[]): Promise<ClientProfile[]>;
	/**
	 * Atômico: define `origin = CLIENT_CREATED` e `ownerUserId = userId` só se o
	 * perfil for ADVISOR_CREATED e não tiver dono. Devolve o perfil atualizado,
	 * ou null se não existir ou já tiver sido assumido (dono nunca muda).
	 */
	claimIfUnowned(id: string, userId: string): Promise<ClientProfile | null>;
	/**
	 * Atômico: define `ownerUserId = userId` só se o perfil for CLIENT_CREATED
	 * e não tiver dono (perfil nascido de convite). Devolve o perfil
	 * atualizado, ou null se não existir, for ADVISOR_CREATED ou já tiver dono.
	 */
	setOwnerIfUnowned(id: string, userId: string): Promise<ClientProfile | null>;
	/**
	 * LGPD: nos perfis daquele dono, troca `name` por `ERASED_CLIENT_NAME` e
	 * remove `ownerUserId`. Devolve quantos mudaram.
	 */
	anonymizeByOwner(userId: string): Promise<number>;
	/** LGPD: ids dos perfis daquele dono (lido antes de `anonymizeByOwner`). */
	listIdsByOwner(userId: string): Promise<string[]>;
	/** Só para desfazer a criação do perfil. */
	deleteById(id: string): Promise<void>;
}
