export const ADVISOR_RELATIONSHIP_NOTIFIER = Symbol(
	'ADVISOR_RELATIONSHIP_NOTIFIER'
);

export type RelationshipUpdateKind = 'ACCEPTED' | 'DECLINED' | 'REVOKED';

export interface RelationshipUpdateInput {
	orgId: string;
	clientProfileId: string;
	kind: RelationshipUpdateKind;
}

export interface RelationshipNotifierPort {
	/**
	 * Avisa por e-mail os assessores do cliente e os `ORG_ADMIN` da
	 * organização de que o investidor respondeu ao convite ou revogou o
	 * acesso. Pode lançar: quem chama nunca deixa isso mudar o resultado da
	 * ação do investidor.
	 */
	notify(input: RelationshipUpdateInput): Promise<void>;
}
