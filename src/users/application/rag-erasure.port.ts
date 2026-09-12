export const RAG_ERASURE = Symbol('RAG_ERASURE');

export interface RagErasureResult {
	erased: boolean;
	chunksDeleted?: number;
	auditRowsAnonymized?: number;
	/** Preenchido quando `erased` e false — motivo da falha, pra log/reconciliacao. */
	failureReason?: string;
}

/**
 * Apaga os dados de RAG de um usuario (TRA-78, LGPD).
 *
 * O RAG replica dado financeiro pessoal num Postgres separado, fora do
 * banco transacional. Exclusao de conta precisa alcancar essa copia,
 * senao o dado sobrevive indefinidamente.
 */
export interface RagErasurePort {
	eraseUserData(userId: string): Promise<RagErasureResult>;
}
