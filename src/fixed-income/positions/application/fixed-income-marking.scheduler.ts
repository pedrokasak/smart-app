import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
	AGENT_GATE,
	AgentGate,
} from 'src/agent-control/application/agent-gate.port';
import { AgentRun } from 'src/agent-control/application/agent-run.decorator';
import { Cron } from '@nestjs/schedule';
import { FixedIncomePositionsService } from './fixed-income-positions.service';

/**
 * Marcação diária da renda fixa (TRA-230).
 *
 * 11h de Brasília: meia hora depois da sincronização das séries do BACEN
 * (10h30, `macro-series-sync`), quando o CDI do dia útil anterior já está
 * no espelho. Idempotente: marcar duas vezes no mesmo dia grava o mesmo valor.
 */
@Injectable()
export class FixedIncomeMarkingScheduler {
	private readonly logger = new Logger(FixedIncomeMarkingScheduler.name);

	constructor(
		private readonly positions: FixedIncomePositionsService,
		@Optional() @Inject(AGENT_GATE) private readonly agentGate?: AgentGate
	) {}

	@Cron('0 11 * * *', {
		name: 'fixed-income-marking',
		timeZone: 'America/Sao_Paulo',
	})
	@AgentRun('fixed-income-marking')
	async run(): Promise<void> {
		const written = await this.positions.markAll();
		this.logger.log(`Renda fixa marcada na curva: ${written} posição(ões).`);
	}
}
