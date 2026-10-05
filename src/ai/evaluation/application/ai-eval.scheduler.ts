import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AI_EVAL_CONFIG, AiEvalConfig } from './ai-eval.config';
import { AiEvalService } from './ai-eval.service';

/** Relógio da avaliação de IA (TRA-242): segunda-feira, 6h de Brasília. */
@Injectable()
export class AiEvalScheduler {
	private readonly logger = new Logger(AiEvalScheduler.name);

	constructor(
		private readonly evaluation: AiEvalService,
		@Inject(AI_EVAL_CONFIG) private readonly config: AiEvalConfig
	) {}

	@Cron('0 6 * * 1', { name: 'ai-eval', timeZone: 'America/Sao_Paulo' })
	async run(): Promise<void> {
		if (!this.config.enabled) return;
		try {
			await this.evaluation.run();
		} catch (err) {
			this.logger.error(
				`Avaliação de IA falhou: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}
}
