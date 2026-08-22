import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
	RagIngestItem,
	RagIngestionPort,
	RagIngestionResult,
} from 'src/ai/rag-ingestion/application/rag-ingestion.port';

/**
 * Chama POST /api/rag/ingest no trackerr-ia (TRA-84).
 *
 * Nunca lança: numa varredura de cron por muitos usuários, a falha de um não
 * pode derrubar os outros. Falha vira `ingested: false` com o motivo, e o
 * chamador loga e segue. A ingestão é idempotente por content_hash no
 * trackerr-ia (TRA-74), então repetir no próximo ciclo é seguro e barato.
 */
@Injectable()
export class TrackerrIaRagIngestionAdapter implements RagIngestionPort {
	private readonly logger = new Logger(TrackerrIaRagIngestionAdapter.name);
	private readonly trackerIaUrl =
		process.env.TRAKKER_IA_URL || 'http://localhost:8000';

	constructor(private readonly httpService: HttpService) {}

	async ingest(
		userId: string,
		items: RagIngestItem[]
	): Promise<RagIngestionResult> {
		if (!userId) {
			return { ingested: false, failureReason: 'empty_user_id' };
		}

		try {
			const response = await firstValueFrom(
				this.httpService.post<{
					chunks_deleted: number;
					chunks_created: number;
					chunks_unchanged: number;
				}>(
					`${this.trackerIaUrl}/api/rag/ingest`,
					{
						user_id: userId,
						items: items.map((item) => ({
							source_type: item.sourceType,
							source_id: item.sourceId,
							content: item.content,
							metadata: item.metadata ?? null,
							as_of: item.asOf ?? null,
						})),
					},
					{
						headers: { 'Content-Type': 'application/json' },
						timeout: 20000,
					}
				)
			);

			return {
				ingested: true,
				chunksDeleted: response.data?.chunks_deleted ?? 0,
				chunksCreated: response.data?.chunks_created ?? 0,
				chunksUnchanged: response.data?.chunks_unchanged ?? 0,
			};
		} catch (error) {
			this.logger.warn(
				`Falha ao ingerir chunks de RAG do usuário ${userId}: ${error?.message}`
			);
			return { ingested: false, failureReason: error?.message };
		}
	}
}
