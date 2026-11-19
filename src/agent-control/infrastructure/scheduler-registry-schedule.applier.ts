import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronTime } from 'cron';
import { AgentScheduleApplier } from 'src/agent-control/application/ports/agent-control-side-effects.port';
import { AgentDefinition } from 'src/agent-control/domain/agent-definition';

/**
 * Troca o horário de um `@Cron` em execução (ADR-005, seção 7). Só aceita o
 * que veio da lista fechada da definição — o painel nunca manda cron livre.
 */
@Injectable()
export class SchedulerRegistryScheduleApplier implements AgentScheduleApplier {
	constructor(private readonly scheduler: SchedulerRegistry) {}

	apply(definition: AgentDefinition, cron: string): void {
		if (!definition.cronName) return;
		const job = this.scheduler.getCronJob(definition.cronName);
		if (job.cronTime.source === cron) return;
		job.setTime(new CronTime(cron, definition.timeZone));
	}
}
