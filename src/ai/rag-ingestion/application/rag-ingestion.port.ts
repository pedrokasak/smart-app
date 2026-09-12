import { RagSourceType } from 'src/ai/rag-ingestion/application/rag-source-type';

export const RAG_INGESTION = Symbol('RAG_INGESTION');

export interface RagIngestItem {
	sourceType: RagSourceType;
	sourceId: string;
	content: string;
	metadata?: Record<string, unknown>;
	asOf?: string; // ISO date (YYYY-MM-DD)
}

export interface RagIngestionResult {
	ingested: boolean;
	chunksDeleted?: number;
	chunksCreated?: number;
	chunksUnchanged?: number;
	failureReason?: string;
}

/**
 * Envia fatos de carteira já prontos como texto pro vector store do
 * trackerr-ia (TRA-84). O server decide O QUE vira chunk; o trackerr-ia
 * embeda e guarda. Nunca lança: falha vira `ingested: false`.
 */
export interface RagIngestionPort {
	ingest(userId: string, items: RagIngestItem[]): Promise<RagIngestionResult>;
}
