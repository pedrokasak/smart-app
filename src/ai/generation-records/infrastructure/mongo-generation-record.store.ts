import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GenerationRecordStore } from '../application/generation-recorder.service';
import { GenerationRecord } from '../domain/generation-record';

/** Único arquivo do registro de geração que conhece Mongoose. */
@Injectable()
export class MongoGenerationRecordStore implements GenerationRecordStore {
	constructor(
		@InjectModel('AiGenerationRecord')
		private readonly records: Model<GenerationRecord>
	) {}

	async insert(record: GenerationRecord): Promise<void> {
		await this.records.create(record);
	}

	async findByGenerationId(
		generationId: string
	): Promise<GenerationRecord | null> {
		return this.records
			.findOne({ generationId }, { _id: 0 })
			.lean<GenerationRecord>()
			.exec();
	}
}
