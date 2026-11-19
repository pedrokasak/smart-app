import { ClientProfile } from '../../domain/entities';

export interface ClientProfileStorePort {
	/** Persiste o perfil do cliente; o store gera o id. */
	create(profile: Omit<ClientProfile, 'id'>): Promise<ClientProfile>;
	findById(id: string): Promise<ClientProfile | null>;
	/**
	 * Atômico: define `origin = CLIENT_CREATED` e `ownerUserId = userId` só se o
	 * perfil for ADVISOR_CREATED e não tiver dono. Devolve o perfil atualizado,
	 * ou null se não existir ou já tiver sido assumido (dono nunca muda).
	 */
	claimIfUnowned(id: string, userId: string): Promise<ClientProfile | null>;
}
