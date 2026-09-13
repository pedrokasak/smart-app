import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ThresholdStateStore } from 'src/thresholds/application/ports/threshold-state.port';
import {
	ThresholdStateKey,
	ThresholdStateSnapshot,
} from 'src/thresholds/domain/threshold.types';
import { ThresholdStateDocument } from './threshold-state.model';

/**
 * Adaptador Mongo da porta de estado. Unico arquivo do motor que conhece
 * Mongoose.
 *
 * A gravacao e um upsert pela chave composta (user, ruleId, scope): sem
 * ele, duas avaliacoes concorrentes do mesmo balde criariam dois documentos
 * e a borda de subida dispararia duas vezes. O indice unico do schema
 * fecha a corrida no banco; o upsert evita o erro de chave duplicada.
 */
@Injectable()
export class MongoThresholdStateRepository implements ThresholdStateStore {
	constructor(
		@InjectModel('ThresholdState')
		private readonly model: Model<ThresholdStateDocument>
	) {}

	async load(key: ThresholdStateKey): Promise<ThresholdStateSnapshot | null> {
		const filter = this.filter(key);
		if (!filter) return null;

		const doc = await this.model
			.findOne(filter)
			.lean<ThresholdStateDocument | null>();
		if (!doc) return null;

		return {
			breaching: Boolean(doc.breaching),
			referenceValue: Number(doc.referenceValue ?? 0),
			lastNotifiedAt: doc.lastNotifiedAt
				? new Date(doc.lastNotifiedAt).toISOString()
				: null,
			lastEvaluatedAt: (doc.lastEvaluatedAt
				? new Date(doc.lastEvaluatedAt)
				: new Date()
			).toISOString(),
		};
	}

	async save(
		key: ThresholdStateKey,
		state: ThresholdStateSnapshot
	): Promise<void> {
		const filter = this.filter(key);
		if (!filter) return;

		await this.model.updateOne(
			filter,
			{
				$set: {
					breaching: state.breaching,
					referenceValue: state.referenceValue,
					lastNotifiedAt: state.lastNotifiedAt
						? new Date(state.lastNotifiedAt)
						: null,
					lastEvaluatedAt: new Date(state.lastEvaluatedAt),
				},
			},
			{ upsert: true }
		);
	}

	private filter(key: ThresholdStateKey) {
		if (!Types.ObjectId.isValid(key.userId)) return null;
		return {
			user: new Types.ObjectId(key.userId),
			ruleId: key.ruleId,
			scope: key.scope,
		};
	}
}
