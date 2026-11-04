import { AdvisoryRelationship } from '../../domain/entities';

export interface RelationshipStorePort {
  /** Persiste a relação de assessoria; o store gera o id. */
  create(
    relationship: Omit<AdvisoryRelationship, 'id'>,
  ): Promise<AdvisoryRelationship>;
  findById(id: string): Promise<AdvisoryRelationship | null>;
  /** Devolve a relação ativa entre a organização e o perfil do cliente. */
  findByOrgAndClient(
    orgId: string,
    clientProfileId: string,
  ): Promise<AdvisoryRelationship | null>;
  save(relationship: AdvisoryRelationship): Promise<AdvisoryRelationship>;
}
