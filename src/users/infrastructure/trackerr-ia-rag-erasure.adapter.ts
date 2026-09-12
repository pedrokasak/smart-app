import { HttpService } from '@nestjs/axios';
import { trackerrIaHeaders } from 'src/ai/infrastructure/trackerr-ia-request';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
	RagErasurePort,
	RagErasureResult,
} from 'src/users/application/rag-erasure.port';

/**
 * Chama POST /api/rag/erase no trackerr-ia (TRA-78, LGPD).
 *
 * Semantica DIFERENTE do TrackerrIaDigestNarratorAdapter de proposito.
 * Aquele trata o trackerr-ia como opcional: falhou, cai no fallback, segue
 * a vida. Aqui nao existe fallback — se a chamada falha, o dado pessoal
 * continua la. Por isso: retry, e falha final vira log de ERROR com o
 * userId, nao warning.
 *
 * O que esta chamada NAO faz e bloquear a exclusao da conta. Recusar
 * apagar a conta porque um servico secundario esta fora seria negar ao
 * usuario o proprio direito de exclusao que a rotina existe pra atender.
 * Entao devolve `erased: false` e grita no log.
 *
 * Lacuna residual conhecida: se o trackerr-ia estiver fora durante as tres
 * tentativas, a exclusao fica pendente e so o log registra. O conserto
 * proprio e uma outbox duravel com reprocessamento — fora do escopo desta
 * issue, anotado como follow-up.
 */
@Injectable()
export class TrackerrIaRagErasureAdapter implements RagErasurePort {
	private readonly logger = new Logger(TrackerrIaRagErasureAdapter.name);
	private readonly trackerIaUrl =
		process.env.TRAKKER_IA_URL || 'http://localhost:8000';

	private static readonly MAX_ATTEMPTS = 3;
	private static readonly BASE_BACKOFF_MS = 300;

	constructor(private readonly httpService: HttpService) {}

	async eraseUserData(userId: string): Promise<RagErasureResult> {
		if (!userId) {
			return { erased: false, failureReason: 'empty_user_id' };
		}

		let lastError = '';
		for (
			let attempt = 1;
			attempt <= TrackerrIaRagErasureAdapter.MAX_ATTEMPTS;
			attempt++
		) {
			try {
				const response = await firstValueFrom(
					this.httpService.post<{
						chunks_deleted: number;
						audit_rows_anonymized: number;
					}>(
						`${this.trackerIaUrl}/api/rag/erase`,
						{ user_id: userId },
						{
							headers: trackerrIaHeaders(),
							timeout: 8000,
						}
					)
				);

				this.logger.log(
					`[LGPD] Dados de RAG apagados para usuário ${userId}: ` +
						`chunks=${response.data?.chunks_deleted ?? 0} ` +
						`auditoria_anonimizada=${response.data?.audit_rows_anonymized ?? 0}`
				);
				return {
					erased: true,
					chunksDeleted: response.data?.chunks_deleted ?? 0,
					auditRowsAnonymized: response.data?.audit_rows_anonymized ?? 0,
				};
			} catch (error) {
				lastError = error?.message || 'erro desconhecido';
				if (attempt < TrackerrIaRagErasureAdapter.MAX_ATTEMPTS) {
					// O endpoint e idempotente, entao repetir e seguro mesmo se a
					// tentativa anterior chegou a apagar antes do timeout.
					await this.delay(
						TrackerrIaRagErasureAdapter.BASE_BACKOFF_MS * attempt
					);
				}
			}
		}

		// ERROR, nao warn: isto precisa acionar alerta. Dado pessoal ficou pra
		// tras e alguem tem que reprocessar.
		this.logger.error(
			`[LGPD] FALHA ao apagar dados de RAG do usuário ${userId} após ` +
				`${TrackerrIaRagErasureAdapter.MAX_ATTEMPTS} tentativas: ${lastError}. ` +
				`Dado pessoal permanece no trackerr-ia e exige reprocessamento manual.`
		);
		return { erased: false, failureReason: lastError };
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
