import { PortalGrant } from '../../domain/portal-access';

export interface PortalGrantStorePort {
	/**
	 * Idempotente: com uma liberação ativa do usuário, devolve essa (sem mudar
	 * quem nem quando liberou). Liberações concorrentes do mesmo usuário
	 * terminam numa só.
	 */
	grant(userId: string, grantedBy: string, at: Date): Promise<PortalGrant>;

	/** Encerra a liberação ativa. False quando não havia nenhuma. */
	revoke(userId: string, at: Date): Promise<boolean>;

	findActive(userId: string): Promise<PortalGrant | null>;

	listActive(): Promise<PortalGrant[]>;
}
