import { AdvisoryRelationship } from '../../domain/entities';

export interface RelationshipStorePort {
	/** Persiste a relação de assessoria; o store gera o id. */
	create(
		relationship: Omit<AdvisoryRelationship, 'id'>
	): Promise<AdvisoryRelationship>;
	findById(id: string): Promise<AdvisoryRelationship | null>;
	/**
	 * Devolve a relação mais relevante entre a organização e o perfil do
	 * cliente, independente do status: prefere a ACTIVE; sem ACTIVE, a mais
	 * recente (ordem de criação). Null só se nunca existiu. O chamador inspeciona
	 * `status`.
	 */
	findByOrgAndClient(
		orgId: string,
		clientProfileId: string
	): Promise<AdvisoryRelationship | null>;
	save(relationship: AdvisoryRelationship): Promise<AdvisoryRelationship>;
	/** Atômico: PENDING -> ACTIVE gravando consentId. Null se não estava PENDING. */
	activate(id: string, consentId: string): Promise<AdvisoryRelationship | null>;
	/**
	 * Atômico: troca `consentId` só se a relação estiver ACTIVE. Null se não
	 * existe ou não está ACTIVE (nada muda).
	 */
	setConsentIfActive(
		id: string,
		consentId: string
	): Promise<AdvisoryRelationship | null>;
	/** LGPD: as relações ACTIVE desses perfis (lista vazia => vazio). */
	listActiveByClientProfiles(
		clientProfileIds: string[]
	): Promise<AdvisoryRelationship[]>;
}
