import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CotahistQuote } from '../domain/cotahist-parser';
import { DailyCloseStore, StoredClose } from '../application/ports';
import {
	DAILY_CLOSE_COVERAGE_MODEL,
	DAILY_CLOSE_MODEL,
	DailyCloseCoverageDocument,
	DailyCloseDocument,
} from './daily-close.model';

@Injectable()
export class MongoDailyCloseStore implements DailyCloseStore {
	constructor(
		@InjectModel(DAILY_CLOSE_MODEL)
		private readonly closes: Model<DailyCloseDocument>,
		@InjectModel(DAILY_CLOSE_COVERAGE_MODEL)
		private readonly coverage: Model<DailyCloseCoverageDocument>
	) {}

	async upsertMany(quotes: CotahistQuote[]): Promise<number> {
		if (!quotes.length) return 0;
		const result = await this.closes.bulkWrite(
			quotes.map((quote) => ({
				updateOne: {
					filter: { symbol: quote.symbol, date: quote.date },
					update: { $set: quote },
					upsert: true,
				},
			})),
			{ ordered: false }
		);
		return (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0);
	}

	async find(symbol: string, from: string): Promise<StoredClose[]> {
		const rows = await this.closes
			.find({ symbol: symbol.toUpperCase(), date: { $gte: from } })
			.select({ _id: 0, date: 1, close: 1 })
			.sort({ date: 1 })
			.lean()
			.exec();
		return rows.map((row) => ({ date: row.date, close: row.close }));
	}

	async hasDate(date: string): Promise<boolean> {
		return !!(await this.closes.exists({ date }));
	}

	count(): Promise<number> {
		return this.closes.estimatedDocumentCount().exec();
	}

	async latestDate(): Promise<string | null> {
		const row = await this.closes
			.findOne()
			.sort({ date: -1 })
			.select({ _id: 0, date: 1 })
			.lean()
			.exec();
		return row?.date ?? null;
	}

	async coveredYears(
		symbols: string[],
		currentYear: number,
		staleBefore: Date
	): Promise<Map<string, Set<number>>> {
		const rows = await this.coverage
			.find({
				symbol: { $in: symbols },
				$or: [
					{ year: { $lt: currentYear } },
					{ coveredAt: { $gte: staleBefore } },
				],
			})
			.select({ _id: 0, symbol: 1, year: 1 })
			.lean()
			.exec();
		const byYear = new Map<string, Set<number>>();
		for (const { symbol, year } of rows) {
			byYear.set(symbol, (byYear.get(symbol) ?? new Set()).add(year));
		}
		return byYear;
	}

	async markCovered(symbols: string[], year: number): Promise<void> {
		if (!symbols.length) return;
		const coveredAt = new Date();
		await this.coverage.bulkWrite(
			symbols.map((symbol) => ({
				updateOne: {
					filter: { symbol, year },
					update: { $set: { symbol, year, coveredAt } },
					upsert: true,
				},
			})),
			{ ordered: false }
		);
	}
}
