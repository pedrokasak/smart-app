import { RiDocumentType } from 'src/ri-intelligence/domain/ri-document.types';

/** Contagens do vigia de RI (TRA-267). */
export interface RiWatchCounts {
	discovered: number;
	summarized: number;
	skipped: number;
	failed: number;
	notified: number;
	indexed: number;
}

/** Documento que saiu da fila sem resumo. Documento publico, sem usuario. */
export interface RiWatchFailureView {
	ticker: string;
	documentType: RiDocumentType;
	title: string;
	publishedAt: string;
	status: 'skipped' | 'failed';
	reason: string | null;
	attempts: number;
	processedAt: string | null;
}

export interface RiWatchMetricsSnapshot {
	/** O que esta esperando agora em cada etapa. */
	queue: {
		pending: number;
		awaitingNotification: number;
		awaitingIndex: number;
	};
	/** Desde sempre. */
	totals: RiWatchCounts;
	/** Desde `since`: descoberto, processado, avisado ou indexado no periodo. */
	window: RiWatchCounts;
	/** Motivos de falha e de documento ignorado no periodo, do mais comum. */
	failureReasons: { reason: string; count: number }[];
	recentFailures: RiWatchFailureView[];
	/** IA gasta pelos resumos processados no periodo. */
	usage: { aiCalls: number; tokens: number };
}

/**
 * Leitura agregada do vigia para o painel admin (TRA-267). Porta propria, e
 * nao mais metodos no `RiWatchStore`: a rotina so escreve e consome filas;
 * quem le metricas e outro caso de uso.
 */
export interface RiWatchMetricsReader {
	read(since: Date): Promise<RiWatchMetricsSnapshot>;
}

export const RI_WATCH_METRICS_READER = Symbol('RI_WATCH_METRICS_READER');
