import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
	AGENT_GATE,
	AgentGate,
	agentAllows,
} from 'src/agent-control/application/agent-gate.port';
import { Cron } from '@nestjs/schedule';
import { MacroSeriesService } from './macro-series.service';

/**
 * Sincronização diária das séries macro (TRA-227).
 *
 * 10h30 de Brasília: o CDI do dia útil anterior já saiu e o job não disputa
 * janela com os crons das 3h–9h. Idempotente — o upsert por (série, dia)
 * permite rodar em mais de uma instância sem duplicar nada.
 */
@Injectable()
export class MacroSeriesScheduler {
	private readonly logger = new Logger(MacroSeriesScheduler.name);

	constructor(
		private readonly macroSeries: MacroSeriesService,
		@Optional() @Inject(AGENT_GATE) private readonly agentGate?: AgentGate
	) {}

	@Cron('30 10 * * *', {
		name: 'macro-series-sync',
		timeZone: 'America/Sao_Paulo',
	})
	async run(): Promise<void> {
		if (!(await agentAllows(this.agentGate, 'macro-series'))) return;
		const result = await this.macroSeries.syncAll();
		this.logger.log(`Séries macro sincronizadas: ${JSON.stringify(result)}`);
	}
}
