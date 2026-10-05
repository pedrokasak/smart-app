import { Inject, Injectable, Logger } from '@nestjs/common';
import { scrubPii } from 'src/common/privacy/scrub-pii';
import { findRegressions } from 'src/ai/evaluation/domain/ai-eval-regressions';
import {
	AI_EVAL_REPORT_STORE,
	AiEvalReportStore,
	StoredAiEvalReport,
} from './ai-eval-report-store.port';
import { AI_EVAL_RUNNER, AiEvalRunnerPort } from './ai-eval-runner.port';
import {
	AI_EVAL_SAMPLE_SOURCE,
	AiEvalSampleSource,
} from './ai-eval-sample-source.port';
import { AI_EVAL_CONFIG, AiEvalConfig } from './ai-eval.config';

const DAY_MS = 24 * 60 * 60 * 1000;
// Mesmos tetos do schema de `/api/evals/run` no trackerr-ia: um texto maior
// derrubaria o lote inteiro com 422, e a semana ficaria sem relatório.
const MAX_QUESTION = 2000;
const MAX_ANSWER = 6000;

/**
 * Avaliação semanal das respostas de IA (TRA-242).
 *
 * 1. Amostra as respostas do chat da semana (histórico: intenção e rota).
 * 2. Tira a PII aqui, antes de sair do server; o trackerr-ia repete.
 * 3. O trackerr-ia junta a amostra do RAG, roda as checagens determinísticas
 *    e o juiz, e devolve só agregados.
 * 4. Guarda o relatório com o que piorou desde o anterior, e mantém só os
 *    últimos (retenção).
 *
 * Uma rodada por vez: a segunda chamada enquanto a primeira roda não
 * dispara outra (o juiz custa por amostra).
 */
@Injectable()
export class AiEvalService {
	private readonly logger = new Logger(AiEvalService.name);
	private running = false;

	constructor(
		@Inject(AI_EVAL_SAMPLE_SOURCE) private readonly source: AiEvalSampleSource,
		@Inject(AI_EVAL_RUNNER) private readonly runner: AiEvalRunnerPort,
		@Inject(AI_EVAL_REPORT_STORE) private readonly store: AiEvalReportStore,
		@Inject(AI_EVAL_CONFIG) private readonly config: AiEvalConfig
	) {}

	get isRunning(): boolean {
		return this.running;
	}

	async run(now: Date = new Date()): Promise<StoredAiEvalReport | null> {
		if (this.running) return null;
		this.running = true;
		try {
			const since = new Date(now.getTime() - this.config.windowDays * DAY_MS);
			const samples = await this.source.sampleChatAnswers(
				since,
				this.config.chatSamples
			);
			const report = await this.runner.run({
				items: samples.map((sample) => ({
					id: sample.id,
					route: sample.routingMode,
					intent: sample.intent.slice(0, 64),
					question: scrubPii(sample.question).slice(0, MAX_QUESTION),
					answer: scrubPii(sample.answer).slice(0, MAX_ANSWER),
				})),
				windowDays: this.config.windowDays,
				maxRagSamples: this.config.ragSamples,
			});
			const previous = await this.store.latest();
			const stored: StoredAiEvalReport = {
				createdAt: now.toISOString(),
				windowDays: this.config.windowDays,
				chatSamples: samples.length,
				report,
				regressions: findRegressions(previous?.report ?? null, report),
			};
			await this.store.save(stored);
			await this.store.prune(this.config.keepReports);
			this.logger.log(
				`Avaliação de IA: ${report.totals?.evaluated ?? 0} avaliada(s), ` +
					`${stored.regressions.length} regressão(ões)`
			);
			return stored;
		} finally {
			this.running = false;
		}
	}

	latest(): Promise<StoredAiEvalReport | null> {
		return this.store.latest();
	}
}
