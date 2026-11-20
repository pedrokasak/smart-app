import { Consent } from '../../domain/consent.entities';

export interface ConsentStorePort {
	/**
	 * Cria ACTIVE com version = (maior da relação) + 1 e marca o ACTIVE
	 * anterior como SUPERSEDED, com `endedAt` igual ao `grantedAt` do novo
	 * consentimento.
	 */
	grant(
		consent: Omit<Consent, 'id' | 'version' | 'status' | 'endedAt'>
	): Promise<Consent>;
	/** Todas as versões da relação (qualquer status), por `version` crescente. */
	listByRelationship(relationshipId: string): Promise<Consent[]>;
	findActiveByRelationship(relationshipId: string): Promise<Consent | null>;
	listActiveByUser(userId: string): Promise<Consent[]>;
	/**
	 * ACTIVE -> REVOKED. Devolve o consentimento encerrado, ou null se não
	 * havia ACTIVE (ou o userId não é o titular).
	 */
	revokeActive(
		relationshipId: string,
		userId: string,
		at: Date
	): Promise<Consent | null>;
	/** LGPD: apaga os consentimentos do usuário e devolve a contagem. */
	deleteByUser(userId: string): Promise<number>;
}
