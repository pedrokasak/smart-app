import { AssetClass } from '../../domain/enums';
import type {
	BenchmarkKey,
	BenchmarkSeriesPort,
} from '../ports/benchmark-series.port';
import type {
	DailyCloseMinor,
	PriceHistoryPort,
} from '../ports/price-history.port';
import { BENCHMARK_KEYS } from './build-portfolio-metrics';

const MAX_PARALLEL_PRICE_LOOKUPS = 5;

/** Classes sem cotação diária: ficam pelo custo e não consultam a fonte. */
const UNQUOTED_CLASSES = new Set<AssetClass>([
	AssetClass.FixedIncome,
	AssetClass.Other,
	AssetClass.Fund,
]);

export interface Instrument {
	symbol: string;
	assetClass: AssetClass;
}

/**
 * Fechamentos e benchmarks que buildPortfolioMetrics consome. Uma única
 * regra para toda métrica do advisor: só classes cotáveis consultam a fonte,
 * no máximo 5 consultas em paralelo, e falha vira "sem cotação" ou null.
 */
export class MarketInputsLoader {
	constructor(
		private readonly prices: PriceHistoryPort,
		private readonly benchmarks: BenchmarkSeriesPort
	) {}

	/**
	 * Um símbolo é consultado uma vez, com a classe da primeira ocorrência.
	 * Fonte que rejeitar deixa o símbolo sem cotação, sem derrubar a chamada.
	 */
	async loadCloses(
		instruments: Instrument[],
		from: string,
		to: string
	): Promise<Map<string, DailyCloseMinor[]>> {
		const quoted = new Map<string, AssetClass>();
		for (const { symbol, assetClass } of instruments) {
			if (!UNQUOTED_CLASSES.has(assetClass) && !quoted.has(symbol)) {
				quoted.set(symbol, assetClass);
			}
		}

		const closes = new Map<string, DailyCloseMinor[]>();
		const entries = [...quoted.entries()];
		for (let i = 0; i < entries.length; i += MAX_PARALLEL_PRICE_LOOKUPS) {
			const chunk = entries.slice(i, i + MAX_PARALLEL_PRICE_LOOKUPS);
			const results = await Promise.allSettled(
				chunk.map(([symbol, assetClass]) =>
					this.prices.getDailyCloses(symbol, assetClass, from, to)
				)
			);
			results.forEach((result, j) => {
				if (result.status === 'fulfilled' && Array.isArray(result.value)) {
					closes.set(chunk[j][0], result.value);
				}
			});
		}
		return closes;
	}

	/** Benchmark que rejeitar ou vier não finito fica null; os outros seguem. */
	async loadBenchmarks(
		from: string,
		to: string
	): Promise<Partial<Record<BenchmarkKey, number | null>>> {
		const results = await Promise.allSettled(
			BENCHMARK_KEYS.map((key) => this.benchmarks.periodReturn(key, from, to))
		);
		const returns: Partial<Record<BenchmarkKey, number | null>> = {};
		results.forEach((result, i) => {
			returns[BENCHMARK_KEYS[i]] =
				result.status === 'fulfilled' && Number.isFinite(result.value)
					? result.value
					: null;
		});
		return returns;
	}
}
