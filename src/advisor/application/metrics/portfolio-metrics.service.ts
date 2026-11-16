import { Inject, Injectable } from '@nestjs/common';
import { AssetClass } from '../../domain/enums';
import { Transaction } from '../../domain/portfolio.entities';
import {
	ADVISOR_ALLOCATION_TARGET_STORE,
	ADVISOR_BENCHMARK_SERIES,
	ADVISOR_PRICE_HISTORY,
	ADVISOR_TRANSACTION_STORE,
} from '../advisor.tokens';
import { AccessContext, AuthorizationService } from '../authorization.service';
import type { AllocationTargetStorePort } from '../ports/allocation-target.store.port';
import type {
	BenchmarkKey,
	BenchmarkSeriesPort,
} from '../ports/benchmark-series.port';
import type {
	DailyCloseMinor,
	PriceHistoryPort,
} from '../ports/price-history.port';
import type { TransactionStorePort } from '../ports/transaction.store.port';
import {
	BENCHMARK_KEYS,
	buildPortfolioMetrics,
	ClientPortfolioMetrics,
	measuredWindow,
} from './build-portfolio-metrics';

const MAX_PARALLEL_PRICE_LOOKUPS = 5;

/** Classes sem cotação diária: ficam pelo custo e não consultam a fonte. */
const UNQUOTED_CLASSES = new Set<AssetClass>([
	AssetClass.FixedIncome,
	AssetClass.Other,
]);

@Injectable()
export class PortfolioMetricsService {
	constructor(
		private readonly authorization: AuthorizationService,
		@Inject(ADVISOR_TRANSACTION_STORE)
		private readonly transactions: TransactionStorePort,
		@Inject(ADVISOR_ALLOCATION_TARGET_STORE)
		private readonly targets: AllocationTargetStorePort,
		@Inject(ADVISOR_PRICE_HISTORY)
		private readonly prices: PriceHistoryPort,
		@Inject(ADVISOR_BENCHMARK_SERIES)
		private readonly benchmarks: BenchmarkSeriesPort
	) {}

	async getMetrics(
		ctx: AccessContext,
		clientProfileId: string
	): Promise<ClientPortfolioMetrics> {
		await this.authorization.ensureCanAccessClient(
			ctx,
			clientProfileId,
			'VIEW_PORTFOLIO'
		);

		const [ledger, target] = await Promise.all([
			this.transactions.listByClient(ctx.orgId, clientProfileId),
			this.targets.find(ctx.orgId, clientProfileId),
		]);
		const asOf = new Date().toISOString().slice(0, 10);

		const closes = await this.loadCloses(ledger, asOf);
		const window = measuredWindow({ asOf, ledger, closes });
		const benchmarkReturns = window
			? await this.loadBenchmarks(window.from, window.to)
			: {};

		return buildPortfolioMetrics({
			asOf,
			ledger,
			closes,
			target: target ? target.targets : null,
			benchmarkReturns,
		});
	}

	/** Fonte que rejeitar deixa o símbolo sem cotação, sem derrubar a chamada. */
	private async loadCloses(
		ledger: Transaction[],
		asOf: string
	): Promise<Map<string, DailyCloseMinor[]>> {
		const closes = new Map<string, DailyCloseMinor[]>();
		if (ledger.length === 0) return closes;

		const from = ledger.reduce(
			(min, t) => (t.tradeDate < min ? t.tradeDate : min),
			ledger[0].tradeDate
		);
		const quoted = new Map<string, AssetClass>();
		for (const t of ledger) {
			if (!UNQUOTED_CLASSES.has(t.assetClass) && !quoted.has(t.symbol)) {
				quoted.set(t.symbol, t.assetClass);
			}
		}

		const entries = [...quoted.entries()];
		for (let i = 0; i < entries.length; i += MAX_PARALLEL_PRICE_LOOKUPS) {
			const chunk = entries.slice(i, i + MAX_PARALLEL_PRICE_LOOKUPS);
			const results = await Promise.allSettled(
				chunk.map(([symbol, assetClass]) =>
					this.prices.getDailyCloses(symbol, assetClass, from, asOf)
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

	/** Benchmark que rejeitar fica null; os outros seguem. */
	private async loadBenchmarks(
		from: string,
		to: string
	): Promise<Partial<Record<BenchmarkKey, number | null>>> {
		const results = await Promise.allSettled(
			BENCHMARK_KEYS.map((key) => this.benchmarks.periodReturn(key, from, to))
		);
		const returns: Partial<Record<BenchmarkKey, number | null>> = {};
		results.forEach((result, i) => {
			returns[BENCHMARK_KEYS[i]] =
				result.status === 'fulfilled' ? result.value : null;
		});
		return returns;
	}
}
