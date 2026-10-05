import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
	ChatMessage,
	ChatMessageSchema,
} from 'src/ai/chat-history/schema/chat-message.schema';
import { AiEvalAdminController } from './admin/ai-eval-admin.controller';
import { AI_EVAL_REPORT_STORE } from './application/ai-eval-report-store.port';
import { AI_EVAL_RUNNER } from './application/ai-eval-runner.port';
import { AI_EVAL_SAMPLE_SOURCE } from './application/ai-eval-sample-source.port';
import { AI_EVAL_CONFIG, loadAiEvalConfig } from './application/ai-eval.config';
import { AiEvalScheduler } from './application/ai-eval.scheduler';
import { AiEvalService } from './application/ai-eval.service';
import { MongoChatEvalSampleSource } from './infrastructure/mongo-chat-eval-sample.source';
import {
	AI_EVAL_REPORT_MODEL,
	aiEvalReportSchema,
	MongoAiEvalReportStore,
} from './infrastructure/mongo-ai-eval-report.store';
import { TrackerrIaAiEvalAdapter } from './infrastructure/trackerr-ia-ai-eval.adapter';

/**
 * Avaliação offline das respostas de IA (TRA-242): job semanal, relatório
 * agregado guardado e endpoint admin. O histórico do chat é registrado aqui
 * também (mesmo schema; o Mongoose não duplica a coleção).
 */
@Module({
	imports: [
		HttpModule,
		MongooseModule.forFeature([
			{ name: ChatMessage.name, schema: ChatMessageSchema },
			{ name: AI_EVAL_REPORT_MODEL, schema: aiEvalReportSchema },
		]),
	],
	controllers: [AiEvalAdminController],
	providers: [
		{ provide: AI_EVAL_CONFIG, useFactory: () => loadAiEvalConfig() },
		MongoChatEvalSampleSource,
		{ provide: AI_EVAL_SAMPLE_SOURCE, useExisting: MongoChatEvalSampleSource },
		TrackerrIaAiEvalAdapter,
		{ provide: AI_EVAL_RUNNER, useExisting: TrackerrIaAiEvalAdapter },
		MongoAiEvalReportStore,
		{ provide: AI_EVAL_REPORT_STORE, useExisting: MongoAiEvalReportStore },
		AiEvalService,
		AiEvalScheduler,
	],
})
export class AiEvaluationModule {}
