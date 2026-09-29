import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import {
	RiWatchDocument,
	RiWatchNotificationSnapshot,
	RiWatchSummarySnapshot,
} from 'src/ri-intelligence/watch/domain/ri-watch';

/**
 * Persistencia do vigia de RI (TRA-240). Porta, e nao model injetado, pelo
 * mesmo motivo do `QuoteFreshnessStore`: o servico roda em teste com um Map
 * em memoria, e a troca de armazenamento nao encosta em caso de uso.
 */
export interface RiWatchStore {
	/**
	 * Registra os documentos ainda desconhecidos e devolve QUANTOS entraram
	 * agora. Idempotente: varreduras repetidas — ou duas instancias rodando
	 * o mesmo cron — nao duplicam documento nem reprocessam o que ja entrou.
	 */
	registerNew(records: RiDocumentRecord[], now: Date): Promise<number>;

	/** Pendentes abaixo do teto de tentativas, mais recentes primeiro. */
	findPending(limit: number): Promise<RiWatchDocument[]>;

	markSummarized(
		key: string,
		summary: RiWatchSummarySnapshot,
		now: Date
	): Promise<void>;

	/** Sai da fila sem nova tentativa (motivo em `lastError`). */
	markSkipped(key: string, reason: string, now: Date): Promise<void>;

	/** Conta a tentativa; no teto o documento vira `failed` e sai da fila. */
	recordFailure(key: string, reason: string, now: Date): Promise<void>;

	/**
	 * Detentores ainda nao avisados, mais recentes primeiro (TRA-261): os
	 * documentos com processamento terminado e os que ainda esperam o resumo
	 * desde antes de `pendingSince`, para o aviso nao ficar preso ao teto de
	 * resumos por rodada.
	 */
	findUnnotified(limit: number, pendingSince: Date): Promise<RiWatchDocument[]>;

	/** Sai da fila de aviso, com o registro de como terminou. */
	markNotified(
		key: string,
		notification: RiWatchNotificationSnapshot,
		now: Date
	): Promise<void>;

	/**
	 * Processamento terminado e texto ainda fora do acervo de RI, mais
	 * recentes primeiro (TRA-264). Inclui o que foi processado antes de o
	 * acervo existir: e assim que ele se preenche.
	 */
	findUnindexed(limit: number): Promise<RiWatchDocument[]>;

	/** Sai da fila do acervo (indexado, ou sem texto para indexar). */
	markIndexed(key: string, now: Date): Promise<void>;
}

export const RI_WATCH_STORE = Symbol('RI_WATCH_STORE');
