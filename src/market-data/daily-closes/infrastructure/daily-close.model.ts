import { Schema } from 'mongoose';

export const DAILY_CLOSE_MODEL = 'DailyClose';
export const DAILY_CLOSE_COVERAGE_MODEL = 'DailyCloseCoverage';

export interface DailyCloseDocument {
	symbol: string;
	date: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
	trades: number;
}

export const dailyCloseSchema = new Schema<DailyCloseDocument>(
	{
		symbol: { type: String, required: true, uppercase: true, trim: true },
		date: { type: String, required: true },
		open: Number,
		high: Number,
		low: Number,
		close: { type: Number, required: true },
		volume: Number,
		trades: Number,
	},
	{ collection: 'daily_closes', versionKey: false }
);
dailyCloseSchema.index({ symbol: 1, date: 1 }, { unique: true });
dailyCloseSchema.index({ date: 1 });

export interface DailyCloseCoverageDocument {
	symbol: string;
	year: number;
	coveredAt: Date;
}

/** (símbolo, ano) em que o arquivo anual já foi tentado. */
export const dailyCloseCoverageSchema = new Schema<DailyCloseCoverageDocument>(
	{
		symbol: { type: String, required: true, uppercase: true, trim: true },
		year: { type: Number, required: true },
		coveredAt: { type: Date, required: true },
	},
	{ collection: 'daily_closes_coverage', versionKey: false }
);
dailyCloseCoverageSchema.index({ symbol: 1, year: 1 }, { unique: true });
