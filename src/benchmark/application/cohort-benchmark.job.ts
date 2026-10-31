import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AgentRun } from 'src/agent-control/application/agent-run.decorator';

import {
	AGENT_GATE,
	AgentGate,
	agentAllows,
} from 'src/agent-control/application/agent-gate.port';
import { Cron } from '@nestjs/schedule';
import { benchmarkCohortJobEnabled } from 'src/env';
import { CohortBenchmarkService } from 'src/benchmark/application/cohort-benchmark.service';

/**
 * Publica o benchmark do mês (ADR-003, TRA-60): dia 1, 04:00 (America/Sao_Paulo),
 * fora do horário de uso.
 *
 * DESLIGADO por padrão (`BENCHMARK_COHORT_JOB_ENABLED`). A base legal é o
 * legítimo interesse, com opt-out em Configurações (fase 2) e texto na
 * política de privacidade. Ligar antes disso agregaria carteiras de quem não
 * teve como sair. Falha não derruba o processo.
 */
@Injectable()
export class CohortBenchmarkJob {
	private readonly logger = new Logger(CohortBenchmarkJob.name);

	constructor(
		private readonly service: CohortBenchmarkService,
		@Optional() @Inject(AGENT_GATE) private readonly agentGate?: AgentGate
	) {}

	@Cron('0 4 1 * *', { timeZone: 'America/Sao_Paulo' })
	@AgentRun('cohort-benchmark')
	async run(): Promise<void> {
		// Ligado pelo painel de agentes (ADR-005); sem o painel, vale a variável.
		if (
			!(await agentAllows(
				this.agentGate,
				'cohort-benchmark',
				benchmarkCohortJobEnabled
			))
		) {
			return;
		}
		try {
			await this.service.publishPeriod();
		} catch (error) {
			this.logger.error(
				`Benchmark mensal falhou: ${(error as Error)?.message ?? error}`
			);
		}
	}
}
