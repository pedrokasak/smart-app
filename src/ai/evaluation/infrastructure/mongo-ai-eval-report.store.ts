import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Schema } from 'mongoose';
import {
	AiEvalReportStore,
	StoredAiEvalReport,
} from 'src/ai/evaluation/application/ai-eval-report-store.port';

export const AI_EVAL_REPORT_MODEL = 'AiEvalReport';

/** Relatórios semanais da avaliação (TRA-242). Agregados, sem texto. */
export const aiEvalReportSchema = new Schema(
	{
		createdAt: { type: Date, required: true, index: true },
		windowDays: { type: Number, required: true },
		chatSamples: { type: Number, required: true },
		report: { type: Schema.Types.Mixed, required: true },
		regressions: { type: Schema.Types.Mixed, default: [] },
	},
	{ collection: 'ai_eval_reports', minimize: false }
);

interface AiEvalReportDocument {
	_id: unknown;
	createdAt: Date;
	windowDays: number;
	chatSamples: number;
	report: StoredAiEvalReport['report'];
	regressions: StoredAiEvalReport['regressions'];
}

@Injectable()
export class MongoAiEvalReportStore implements AiEvalReportStore {
	constructor(
		@InjectModel(AI_EVAL_REPORT_MODEL)
		private readonly model: Model<AiEvalReportDocument>
	) {}

	async latest(): Promise<StoredAiEvalReport | null> {
		const doc = await this.model
			.findOne({})
			.sort({ createdAt: -1 })
			.lean<AiEvalReportDocument | null>()
			.exec();
		if (!doc) return null;
		return {
			createdAt: new Date(doc.createdAt).toISOString(),
			windowDays: doc.windowDays,
			chatSamples: doc.chatSamples,
			report: doc.report,
			regressions: doc.regressions ?? [],
		};
	}

	async save(report: StoredAiEvalReport): Promise<void> {
		await this.model.create({
			...report,
			createdAt: new Date(report.createdAt),
		});
	}

	async prune(keep: number): Promise<void> {
		const stale = await this.model
			.find({})
			.sort({ createdAt: -1 })
			.skip(keep)
			.select('_id')
			.lean<{ _id: unknown }[]>()
			.exec();
		if (stale.length) {
			await this.model
				.deleteMany({ _id: { $in: stale.map((doc) => doc._id) } })
				.exec();
		}
	}
}
