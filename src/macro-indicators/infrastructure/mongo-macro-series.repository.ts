import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
	MacroSeriesPoint,
	MacroSeriesRepository,
} from '../application/macro-series.ports';
import type { MacroSeriesPointDocument } from './macro-series-point.model';

/** Único arquivo do módulo que conhece Mongoose. */
@Injectable()
export class MongoMacroSeriesRepository implements MacroSeriesRepository {
	constructor(
		@InjectModel('MacroSeriesPoint')
		private readonly model: Model<MacroSeriesPointDocument>
	) {}

	async findRange(
		code: number,
		from: string,
		to: string
	): Promise<MacroSeriesPoint[]> {
		const rows = await this.model
			.find(
				{ seriesCode: code, date: { $gte: from, $lte: to } },
				{ _id: 0, date: 1, value: 1 }
			)
			.sort({ date: 1 })
			.lean()
			.exec();
		return rows.map((row) => ({ date: row.date, value: row.value }));
	}

	async lastPoint(
		code: number
	): Promise<{ date: string; fetchedAt: Date } | null> {
		const row = await this.model
			.findOne({ seriesCode: code }, { _id: 0, date: 1, fetchedAt: 1 })
			.sort({ date: -1 })
			.lean()
			.exec();
		return row ? { date: row.date, fetchedAt: row.fetchedAt } : null;
	}

	async upsertMany(
		code: number,
		points: MacroSeriesPoint[],
		fetchedAt: Date
	): Promise<number> {
		if (!points.length) return 0;
		const result = await this.model.bulkWrite(
			points.map((point) => ({
				updateOne: {
					filter: { seriesCode: code, date: point.date },
					update: { $set: { value: point.value, fetchedAt } },
					upsert: true,
				},
			})),
			{ ordered: false }
		);
		return result.upsertedCount + result.modifiedCount;
	}
}
