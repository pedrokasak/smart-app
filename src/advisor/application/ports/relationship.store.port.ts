import { AdvisoryRelationship } from '../../domain/entities';
import { RelationshipStatus } from '../../domain/enums';

export interface ListRelationshipsQuery {
	statuses: RelationshipStatus[];
	/** Cursor opaco devolvido por uma página anterior. */
	cursor?: string;
	limit: number;
}

export interface RelationshipPage {
	items: AdvisoryRelationship[];
	nextCursor: string | null;
}

export interface RelationshipStorePort {
	/** Persiste a relação de assessoria; o store gera o id. */
	create(
		relationship: Omit<AdvisoryRelationship, 'id'>
	): Promise<AdvisoryRelationship>;
	findById(id: string): Promise<AdvisoryRelationship | null>;
	/** Quando a relação foi criada (início do vínculo); null se não existe. */
	findCreatedAt(id: string): Promise<Date | null>;
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
	/**
	 * Página das relações da organização nos status pedidos, `createdAt`
	 * decrescente com desempate por id. O cursor codifica (createdAt, id) em
	 * base64url; `nextCursor` é null na última página.
	 */
	listByOrg(
		orgId: string,
		query: ListRelationshipsQuery
	): Promise<RelationshipPage>;
	/** LGPD: as relações ACTIVE desses perfis (lista vazia => vazio). */
	listActiveByClientProfiles(
		clientProfileIds: string[]
	): Promise<AdvisoryRelationship[]>;
	/**
	 * Mesma paginação de `listByOrg`, só das relações cujo perfil não tem
	 * nenhuma atribuição a assessor naquela organização.
	 */
	listUnassignedByOrg(
		orgId: string,
		query: ListRelationshipsQuery
	): Promise<RelationshipPage>;
	/** Só para desfazer a criação da relação. */
	deleteById(id: string): Promise<void>;
}
