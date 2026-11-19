import { Inject, Injectable, Optional } from '@nestjs/common';
import {
	AGENT_GATE,
	AgentGate,
} from 'src/agent-control/application/agent-gate.port';
import { AgentRun } from 'src/agent-control/application/agent-run.decorator';

import { Cron } from '@nestjs/schedule';
import { DAILY_CLOSES_CONFIG, DailyClosesConfig } from './daily-closes.config';
import { DailyClosesJobService } from './daily-closes-job.service';

/**
 * Relógio do histórico diário (TRA-251): dias úteis, 22h de Brasília. A B3
 * publica o arquivo do pregão no fim da tarde; se atrasar, a rodada seguinte
 * recupera (o job confere os últimos dias).
 */
@Injectable()
export class DailyClosesScheduler {
	constructor(
		private readonly job: DailyClosesJobService,
		@Inject(DAILY_CLOSES_CONFIG) private readonly config: DailyClosesConfig,
		@Optional() @Inject(AGENT_GATE) private readonly agentGate?: AgentGate
	) {}

	@Cron('0 22 * * 1-5', {
		name: 'daily-closes',
		timeZone: 'America/Sao_Paulo',
	})
	@AgentRun('daily-closes')
	async run(): Promise<void> {
		if (!this.config.enabled) return;
		await this.job.run();
	}
}
