import { Schema, model } from 'mongoose';

/**
 * Agregado do benchmark por coorte e mês (ADR-003, TRA-60). Não tem
 * `userId`, `portfolioId` nem nada que aponte para uma pessoa: o que está
 * aqui já passou por k-anonimato e arredondamento.
 */
export interface CohortBenchmarkDocument {
	period: string;
	key: string;
	level: string;
	wealthBands: string[];
	sampleSizeBucket: number;
	score: { p25: number; p50: number; p75: number };
	return12mPp: { p25: number; p50: number; p75: number };
	computedAt: Date;
}

const stats = {
	p25: { type: Number, required: true },
	p50: { type: Number, required: true },
	p75: { type: Number, required: true },
};

export const cohortBenchmarkSchema = new Schema<CohortBenchmarkDocument>(
	{
		period: { type: String, required: true },
		key: { type: String, required: true },
		level: { type: String, required: true },
		wealthBands: { type: [String], required: true },
		sampleSizeBucket: { type: Number, required: true },
		score: { type: stats, required: true, _id: false },
		return12mPp: { type: stats, required: true, _id: false },
		computedAt: { type: Date, required: true },
	},
	{ collection: 'cohort_benchmarks' }
);

cohortBenchmarkSchema.index({ period: 1, key: 1 }, { unique: true });
cohortBenchmarkSchema.index({ level: 1, wealthBands: 1, period: -1 });

export const CohortBenchmarkModel = model<CohortBenchmarkDocument>(
	'CohortBenchmark',
	cohortBenchmarkSchema
);
