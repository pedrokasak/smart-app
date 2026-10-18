import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
	CohortBenchmarkStore,
	PublishedBenchmark,
} from 'src/benchmark/application/cohort-benchmark-store.port';
import {
	cohortKey,
	type CohortBenchmark,
	type CohortLevel,
	type WealthBand,
} from 'src/benchmark/domain/cohort';
import type { CohortBenchmarkDocument } from 'src/benchmark/infrastructure/cohort-benchmark.model';

/** Meses de histórico mantidos; o resto sai a cada publicação. */
export const BENCHMARK_RETENTION_MONTHS = 12;

function periodBefore(period: string, months: number): string {
	const [year, month] = period.split('-').map(Number);
	const index = year * 12 + (month - 1) - months;
	const y = Math.floor(index / 12);
	const m = (index % 12) + 1;
	return `${y}-${String(m).padStart(2, '0')}`;
}

@Injectable()
export class MongoCohortBenchmarkStore implements CohortBenchmarkStore {
	constructor(
		@InjectModel('CohortBenchmark')
		private readonly model: Model<CohortBenchmarkDocument>
	) {}

	async replacePeriod(
		period: string,
		benchmarks: CohortBenchmark[]
	): Promise<void> {
		await this.model.deleteMany({ period });
		if (benchmarks.length) {
			const computedAt = new Date();
			await this.model.insertMany(
				benchmarks.map((benchmark) => ({
					period,
					key: cohortKey(benchmark.level, benchmark.wealthBands),
					level: benchmark.level,
					wealthBands: benchmark.wealthBands,
					sampleSizeBucket: benchmark.sampleSizeBucket,
					score: benchmark.score,
					return12mPp: benchmark.return12mPp,
					computedAt,
				}))
			);
		}
		await this.model.deleteMany({
			period: { $lt: periodBefore(period, BENCHMARK_RETENTION_MONTHS) },
		});
	}

	async latestFor(
		level: CohortLevel,
		band: WealthBand
	): Promise<PublishedBenchmark | null> {
		const doc = await this.model
			.findOne({ level, wealthBands: band })
			.sort({ period: -1 })
			.lean();
		if (!doc) return null;
		return {
			period: doc.period,
			benchmark: {
				level: doc.level as CohortLevel,
				wealthBands: doc.wealthBands as WealthBand[],
				sampleSizeBucket: doc.sampleSizeBucket,
				score: doc.score,
				return12mPp: doc.return12mPp,
			},
		};
	}
}
