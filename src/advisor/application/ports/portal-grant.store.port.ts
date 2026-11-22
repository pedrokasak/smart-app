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

	/**
	 * LGPD: apaga todas as liberações do usuário, ativas e revogadas (o
	 * histórico também guarda o id). Devolve quantas apagou.
	 */
	deleteAllForUser(userId: string): Promise<number>;
}
