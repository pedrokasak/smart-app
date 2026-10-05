import { AiEvalRegression } from 'src/ai/evaluation/domain/ai-eval-regressions';
import { AiEvalRunReport } from './ai-eval-runner.port';

/** Um relatório semanal guardado (TRA-242): só agregados, nenhum texto. */
export interface StoredAiEvalReport {
	createdAt: string;
	windowDays: number;
	/** Respostas do chat mandadas para avaliação (o RAG conta no `totals`). */
	chatSamples: number;
	report: AiEvalRunReport;
	regressions: AiEvalRegression[];
}

export interface AiEvalReportStore {
	latest(): Promise<StoredAiEvalReport | null>;
	save(report: StoredAiEvalReport): Promise<void>;
	/** Retenção: só os `keep` mais recentes ficam. */
	prune(keep: number): Promise<void>;
}

export const AI_EVAL_REPORT_STORE = Symbol('AI_EVAL_REPORT_STORE');
