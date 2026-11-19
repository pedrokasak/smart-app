import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
	AGENT_GATE,
	AgentGate,
} from 'src/agent-control/application/agent-gate.port';
import { AgentRun } from 'src/agent-control/application/agent-run.decorator';

import { Cron } from '@nestjs/schedule';
import { AI_EVAL_CONFIG, AiEvalConfig } from './ai-eval.config';
import { AiEvalService } from './ai-eval.service';

/** Relógio da avaliação de IA (TRA-242): segunda-feira, 6h de Brasília. */
@Injectable()
export class AiEvalScheduler {
	private readonly logger = new Logger(AiEvalScheduler.name);

	constructor(
		private readonly evaluation: AiEvalService,
		@Inject(AI_EVAL_CONFIG) private readonly config: AiEvalConfig,
		@Optional() @Inject(AGENT_GATE) private readonly agentGate?: AgentGate
	) {}

	@Cron('0 6 * * 1', { name: 'ai-eval', timeZone: 'America/Sao_Paulo' })
	@AgentRun('ai-eval')
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
