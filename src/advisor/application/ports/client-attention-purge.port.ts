/**
 * LGPD: apaga na hora o read model de atenção de um cliente (snapshot,
 * série diária, contato e todos os alertas, inclusive os manuais). Lança em
 * caso de falha, para o apagamento poder ser repetido.
 */
export interface ClientAttentionPurgePort {
	purgeClient(orgId: string, clientProfileId: string): Promise<void>;
}
