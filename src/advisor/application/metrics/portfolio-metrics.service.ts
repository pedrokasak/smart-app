import { Inject, Injectable } from '@nestjs/common';
import {
	ADVISOR_ALLOCATION_TARGET_STORE,
	ADVISOR_BENCHMARK_SERIES,
	ADVISOR_PRICE_HISTORY,
	ADVISOR_TRANSACTION_STORE,
} from '../advisor.tokens';
import { AccessContext, AuthorizationService } from '../authorization.service';
import type { AllocationTargetStorePort } from '../ports/allocation-target.store.port';
import type { BenchmarkSeriesPort } from '../ports/benchmark-series.port';
import type { PriceHistoryPort } from '../ports/price-history.port';
import type { TransactionStorePort } from '../ports/transaction.store.port';
import {
	buildPortfolioMetrics,
	ClientPortfolioMetrics,
	measuredWindow,
} from './build-portfolio-metrics';
import { MarketInputsLoader } from './market-inputs.loader';

@Injectable()
export class PortfolioMetricsService {
	private readonly market: MarketInputsLoader;

	constructor(
		private readonly authorization: AuthorizationService,
		@Inject(ADVISOR_TRANSACTION_STORE)
		private readonly transactions: TransactionStorePort,
		@Inject(ADVISOR_ALLOCATION_TARGET_STORE)
		private readonly targets: AllocationTargetStorePort,
		@Inject(ADVISOR_PRICE_HISTORY)
		prices: PriceHistoryPort,
		@Inject(ADVISOR_BENCHMARK_SERIES)
		benchmarks: BenchmarkSeriesPort
	) {
		this.market = new MarketInputsLoader(prices, benchmarks);
	}

	async getMetrics(
		ctx: AccessContext,
		clientProfileId: string
	): Promise<ClientPortfolioMetrics> {
		await this.authorization.ensureCanAccessClient(
			ctx,
			clientProfileId,
			'VIEW_PORTFOLIO'
		);
		return this.compute(ctx.orgId, clientProfileId, new Date());
	}

	/**
	 * Caminho de sistema (job de atenção): o mesmo cálculo, sem autorização
	 * e sem auditoria. Não é um acesso de assessor; nunca exponha por rota.
	 */
	async computeForSystem(
		orgId: string,
		clientProfileId: string,
		now: Date = new Date()
	): Promise<ClientPortfolioMetrics> {
		return this.compute(orgId, clientProfileId, now);
	}

	private async compute(
		orgId: string,
		clientProfileId: string,
		now: Date
	): Promise<ClientPortfolioMetrics> {
		const [ledger, target] = await Promise.all([
			this.transactions.listByClient(orgId, clientProfileId),
			this.targets.find(orgId, clientProfileId),
		]);
		const asOf = now.toISOString().slice(0, 10);

		const closes =
			ledger.length === 0
				? new Map()
				: await this.market.loadCloses(
						ledger,
						ledger.reduce(
							(min, t) => (t.tradeDate < min ? t.tradeDate : min),
							ledger[0].tradeDate
						),
						asOf
					);
		const window = measuredWindow({ asOf, ledger, closes });
		const benchmarkReturns = window
			? await this.market.loadBenchmarks(window.from, window.to)
			: {};

		return buildPortfolioMetrics({
			asOf,
			ledger,
			closes,
			target: target ? target.targets : null,
			benchmarkReturns,
		});
	}
}
