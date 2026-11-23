/**
 * Pede a recomputação do snapshot e dos alertas de um cliente, fora da
 * requisição. Quem chama não espera nem recebe erro: um pedido perdido é
 * corrigido pela recomputação diária.
 */
export interface ClientSnapshotTriggerPort {
	request(orgId: string, clientProfileId: string): void;
}
