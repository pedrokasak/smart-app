import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
	AGENT_GATE,
	AgentGate,
} from 'src/agent-control/application/agent-gate.port';
import { AgentRun } from 'src/agent-control/application/agent-run.decorator';
import { reportAgentRun } from 'src/agent-control/application/agent-run-context';
import { MarketIntelService } from './market-intel.service';

/**
 * Agendador do agente de inteligência de mercado (ADR-004, F1).
 *
 * Roda às 06h30 (horário de Brasília) — antes da abertura do mercado.
 * Controlável pelo painel administrativo via @AgentRun('market-intel').
 */
@Injectable()
export class MarketIntelScheduler {
	private readonly logger = new Logger(MarketIntelScheduler.name);
	private running = false;

	constructor(
		private readonly service: MarketIntelService,
		@Optional() @Inject(AGENT_GATE) private readonly agentGate?: AgentGate
	) {}

	@Cron('30 6 * * *', {
		name: 'market-intel',
		timeZone: 'America/Sao_Paulo',
	})
	@AgentRun('market-intel')
	async run(): Promise<void> {
		if (this.running) {
			this.logger.warn('Market Intel: rodada anterior ainda em andamento');
			return;
		}

		this.running = true;
		try {
			const result = await this.service.ingest();
			reportAgentRun({
				items: result.itemsNew,
				errors: result.sourcesFailed,
			});
			this.logger.log(
				`Market Intel: ${result.itemsNew} item(ns) novo(s) de ` +
					`${result.sourcesFetched}/${result.sourcesTotal} fonte(s) ` +
					`(${result.itemsDuplicate} dup, ` +
					`${result.storiesCreated} story(ies) nova(s), ` +
					`${result.storiesMerged} merge(s), ` +
					`${result.sourcesFailed} fonte(s) com falha)`
			);
		} catch (err) {
			this.logger.error(
				`Market Intel: rodada falhou: ${err instanceof Error ? err.message : String(err)}`
			);
			throw err;
		} finally {
			this.running = false;
		}
	}
}
