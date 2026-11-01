import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
	GENERATION_RECORDER,
	GENERATION_RECORD_STORE,
	GenerationRecorderService,
} from './application/generation-recorder.service';
import { GenerationRecordsController } from './generation-records.controller';
import { GenerationRecordModel } from './infrastructure/generation-record.model';
import { MongoGenerationRecordStore } from './infrastructure/mongo-generation-record.store';

/**
 * Registro de geração de IA (ADR-004, 9.2). Depende da trilha só pelo token
 * `AUDIT_TRAIL`, que o `AuditModule` global exporta.
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'AiGenerationRecord', schema: GenerationRecordModel.schema },
		]),
	],
	controllers: [GenerationRecordsController],
	providers: [
		MongoGenerationRecordStore,
		{
			provide: GENERATION_RECORD_STORE,
			useExisting: MongoGenerationRecordStore,
		},
		GenerationRecorderService,
		{ provide: GENERATION_RECORDER, useExisting: GenerationRecorderService },
	],
	exports: [GENERATION_RECORDER],
})
export class GenerationRecordsModule {}
