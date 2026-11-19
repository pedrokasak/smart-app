import { Schema, model } from 'mongoose';
import { GenerationRecord } from '../domain/generation-record';

/** Retenção de 5 anos, a mesma da trilha (ADR-004, seção 8.5). */
export const GENERATION_RECORD_TTL_SECONDS = 5 * 365 * 24 * 60 * 60;

/**
 * `ai_generation_records`: um documento por chamada ao LLM. Só ids e hashes,
 * nunca texto do usuário nem da resposta. O registro nunca é atualizado.
 */
const generationRecordSchema = new Schema<GenerationRecord>(
	{
		generationId: { type: String, required: true },
		kind: { type: String, required: true },
		userRef: { type: String, required: true },
		subjectIds: { type: [String], default: [] },
		prompt: { type: Schema.Types.Mixed, required: true },
		model: { type: Schema.Types.Mixed, required: true },
		inputs: { type: Schema.Types.Mixed, required: true },
		checks: { type: Schema.Types.Mixed, required: true },
		confidence: { type: Schema.Types.Mixed, default: null },
		outputSha256: { type: String, required: true },
		recordedAt: { type: Date, required: true },
		recordHash: { type: String, required: true },
	},
	{ collection: 'ai_generation_records', minimize: false, versionKey: false }
);

generationRecordSchema.index(
	{ generationId: 1 },
	{ unique: true, name: 'ai_generation_id' }
);
generationRecordSchema.index(
	{ userRef: 1, recordedAt: -1 },
	{ name: 'ai_generation_user' }
);
generationRecordSchema.index(
	{ recordedAt: 1 },
	{
		name: 'ai_generation_ttl',
		expireAfterSeconds: GENERATION_RECORD_TTL_SECONDS,
	}
);

export const GenerationRecordModel = model<GenerationRecord>(
	'AiGenerationRecord',
	generationRecordSchema
);
