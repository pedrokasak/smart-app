import { ClientSnapshot } from '../../domain/attention.entities';

export interface ClientSnapshotStorePort {
	/** Um snapshot por (orgId, clientProfileId); o último valor vence. */
	upsert(snapshot: ClientSnapshot): Promise<void>;
	find(orgId: string, clientProfileId: string): Promise<ClientSnapshot | null>;
	/**
	 * Snapshots da organização, ordenados por `clientProfileId`. Com
	 * `clientIds`, só esses clientes (lista vazia => nenhum).
	 */
	listByOrg(orgId: string, clientIds?: string[]): Promise<ClientSnapshot[]>;
	/**
	 * R28: só os ids dos clientes com snapshot na organização, ordenados. O
	 * job diário revisita os que não têm mais relação ACTIVE.
	 */
	listClientIds(orgId: string): Promise<string[]>;
	delete(orgId: string, clientProfileId: string): Promise<void>;
}
