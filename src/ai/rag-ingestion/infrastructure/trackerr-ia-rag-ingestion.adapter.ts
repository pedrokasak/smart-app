import { HttpService } from '@nestjs/axios';
import { trackerrIaHeaders } from 'src/ai/infrastructure/trackerr-ia-request';
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
/**
 * Ingestao gera embedding de cada chunk da carteira, entao o tempo cresce
 * com o tamanho do portfolio — nao e uma chamada interativa. Os 20s fixos
 * anteriores estouravam em carteira grande e a ingestao falhava inteira,
 * silenciosamente (o adapter so registra warn e segue).
 *
 * Configuravel porque o limite certo depende do provedor de embedding e do
 * tamanho tipico das carteiras, que mudam sem tocar em codigo.
 */
const RAG_INGESTION_TIMEOUT_MS = Number(
	process.env.RAG_INGESTION_TIMEOUT_MS || 120000
);

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
						headers: trackerrIaHeaders(),
						timeout: RAG_INGESTION_TIMEOUT_MS,
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
