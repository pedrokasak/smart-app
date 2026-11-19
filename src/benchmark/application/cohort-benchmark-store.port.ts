import type {
	CohortBenchmark,
	CohortLevel,
	WealthBand,
} from 'src/benchmark/domain/cohort';

export const COHORT_BENCHMARK_STORE = Symbol('COHORT_BENCHMARK_STORE');

export interface PublishedBenchmark {
	period: string; // YYYY-MM
	benchmark: CohortBenchmark;
}

/** Guarda só o agregado: não existe `userId` em nenhum registro. */
export interface CohortBenchmarkStore {
	replacePeriod(period: string, benchmarks: CohortBenchmark[]): Promise<void>;
	latestFor(
		level: CohortLevel,
		band: WealthBand
	): Promise<PublishedBenchmark | null>;
}
