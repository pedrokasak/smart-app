import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
	EVENT_QUEUE_CONFIG,
	EventQueueConfig,
} from 'src/events/infrastructure/bullmq/queue.config';
import { EmailModule } from 'src/notifications/email/email.module';
import { TwoFactorModule } from 'src/two-factor/two-factor.module';
import { AgentControlAdminController } from './admin/agent-control-admin.controller';
import { AGENT_GATE } from './application/agent-gate.port';
import {
	AGENT_CONTROL_CLOCK,
	AGENT_CONTROL_ENV,
	AgentControlRegistry,
} from './application/agent-control.registry';
import { AgentControlService } from './application/agent-control.service';
import { AGENT_CONTROL_STORE } from './application/ports/agent-control-store.port';
import {
	AGENT_CHANGE_NOTIFIER,
	AGENT_SCHEDULE_APPLIER,
	STEP_UP_VERIFIER,
} from './application/ports/agent-control-side-effects.port';
import {
	AgentControlChangeModel,
	AgentControlModel,
	AgentRunModel,
} from './infrastructure/agent-control.models';
import { AGENT_CONTROL_SYNC } from './application/ports/agent-control-sync.port';
import { AGENT_RUN_STORE } from './application/ports/agent-run-store.port';
import { MongoAgentRunStore } from './infrastructure/mongo-agent-run.store';
import { NoopAgentControlSync } from './infrastructure/noop-agent-control.sync';
import { RedisAgentControlSync } from './infrastructure/redis-agent-control.sync';
import { EmailAgentChangeNotifier } from './infrastructure/email-agent-change.notifier';
import { MongoAgentControlStore } from './infrastructure/mongo-agent-control.store';
import { SchedulerRegistryScheduleApplier } from './infrastructure/scheduler-registry-schedule.applier';
import { TwoFactorStepUpVerifier } from './infrastructure/two-factor-step-up.verifier';

/**
 * Controle de agentes em tempo de execução (ADR-005).
 *
 * Global de propósito: os 18 agendadores consultam `AGENT_GATE` sem que cada
 * módulo precise importar este. A dependência anda num sentido só — o
 * controle não importa nenhum módulo de agente; cada agente pergunta pelo
 * próprio id.
 */
@Global()
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'AgentControl', schema: AgentControlModel.schema },
			{ name: 'AgentControlChange', schema: AgentControlChangeModel.schema },
			{ name: 'AgentRun', schema: AgentRunModel.schema },
		]),
		EmailModule,
		TwoFactorModule,
	],
	controllers: [AgentControlAdminController],
	providers: [
		{ provide: AGENT_CONTROL_ENV, useValue: process.env },
		{ provide: AGENT_CONTROL_CLOCK, useValue: () => new Date() },
		MongoAgentControlStore,
		{ provide: AGENT_CONTROL_STORE, useExisting: MongoAgentControlStore },
		SchedulerRegistryScheduleApplier,
		{
			provide: AGENT_SCHEDULE_APPLIER,
			useExisting: SchedulerRegistryScheduleApplier,
		},
		TwoFactorStepUpVerifier,
		{ provide: STEP_UP_VERIFIER, useExisting: TwoFactorStepUpVerifier },
		EmailAgentChangeNotifier,
		{ provide: AGENT_CHANGE_NOTIFIER, useExisting: EmailAgentChangeNotifier },
		MongoAgentRunStore,
		{ provide: AGENT_RUN_STORE, useExisting: MongoAgentRunStore },
		{
			provide: AGENT_CONTROL_SYNC,
			// Mesmo Redis da fila de eventos; sem ele (fila desligada, teste), vale só
			// a recarga de 30 s.
			useFactory: (config: EventQueueConfig) =>
				config.enabled
					? new RedisAgentControlSync(config.connection)
					: new NoopAgentControlSync(),
			inject: [EVENT_QUEUE_CONFIG],
		},
		AgentControlRegistry,
		{ provide: AGENT_GATE, useExisting: AgentControlRegistry },
		AgentControlService,
	],
	exports: [AGENT_GATE],
})
export class AgentControlModule {}
