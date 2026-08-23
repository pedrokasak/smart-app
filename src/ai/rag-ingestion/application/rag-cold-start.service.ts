import { Injectable, Logger } from '@nestjs/common';
import { RagIngestionScheduler } from 'src/ai/rag-ingestion/application/rag-ingestion.scheduler';

/**
 * Dispara ingestão de RAG sob demanda pra resolver o cold-start (TRA-88).
 *
 * A ingestão principal é um cron diário (TRA-84). Entre o momento em que um
 * usuário Pro entra e o próximo ciclo do cron, `document_chunks` está vazio
 * pra ele e toda pergunta de RAG cai em `no_context`. Este serviço fecha essa
 * janela: quando o usuário interage com o chat, dispara a ingestão dele em
 * background.
 *
 * Fire-and-forget de propósito — NUNCA bloqueia a resposta do chat. E com
 * cooldown por usuário: a ingestão é incremental por hash (TRA-74), então
 * repetir é barato, mas não a ponto de valer disparar a cada tecla. O gate de
 * plano vive no scheduler (`ingestForUser` só roda pra Pro+).
 */
@Injectable()
export class RagColdStartService {
	private readonly logger = new Logger(RagColdStartService.name);
	private readonly lastTriggered = new Map<string, number>();
	private static readonly COOLDOWN_MS = 10 * 60 * 1000; // 10 min

	constructor(private readonly scheduler: RagIngestionScheduler) {}

	/**
	 * Agenda a ingestão do usuário em background. Retorna imediatamente; o
	 * resultado nunca afeta o chamador. Idempotente dentro do cooldown.
	 */
	trigger(userId: string): void {
		if (!userId) return;

		const now = Date.now();
		const last = this.lastTriggered.get(userId) ?? 0;
		if (now - last < RagColdStartService.COOLDOWN_MS) return;
		this.lastTriggered.set(userId, now);

		// Não await: o chat não espera a ingestão. Erros são engolidos aqui —
		// falha de ingestão não pode virar erro na resposta do usuário; o cron
		// diário é a rede de segurança.
		void this.scheduler
			.ingestForUser(userId)
			.then((ingested) => {
				if (ingested) {
					this.logger.log(
						`Cold-start: carteira do usuário ${userId} ingerida.`
					);
				}
			})
			.catch((error) => {
				this.logger.warn(
					`Cold-start falhou para usuário ${userId}: ${error?.message}`
				);
			});
	}
}
