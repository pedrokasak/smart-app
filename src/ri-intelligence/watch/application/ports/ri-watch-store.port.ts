import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import {
	RiWatchDocument,
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
}

export const RI_WATCH_STORE = Symbol('RI_WATCH_STORE');
