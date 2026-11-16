import { AppModule } from 'src/app.module';
import { AdvisorModule } from './advisor.module';
import {
	ADVISOR_ALLOCATION_TARGET_STORE,
	ADVISOR_BENCHMARK_SERIES,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_ORG_STORE,
	ADVISOR_PRICE_HISTORY,
	ADVISOR_RELATIONSHIP_STORE,
	ADVISOR_TRANSACTION_STORE,
} from './application/advisor.tokens';
import { AllocationTargetService } from './application/allocation-target.service';
import { CsvImportService } from './application/csv/csv-import.service';
import { PortfolioMetricsService } from './application/metrics/portfolio-metrics.service';
import { TransactionService } from './application/transaction.service';
import { MacroBenchmarkSeriesAdapter } from './infrastructure/macro-benchmark-series.adapter';
import { MarketPriceHistoryAdapter } from './infrastructure/market-price-history.adapter';

/**
 * Sem subir um segundo grafo: `app.module.di.spec.ts` ja resolve o AppModule
 * inteiro (incluindo este modulo). Aqui so se trava a ligacao estatica.
 */
describe('AdvisorModule wiring', () => {
	it('is imported by AppModule', () => {
		const imports: unknown[] = Reflect.getMetadata('imports', AppModule);
		expect(imports).toContain(AdvisorModule);
	});

	it('provides the four store tokens', () => {
		const providers: Array<{ provide?: unknown }> = Reflect.getMetadata(
			'providers',
			AdvisorModule
		);
		const provided = providers.map((p) => p.provide);
		for (const token of [
			ADVISOR_ORG_STORE,
			ADVISOR_MEMBERSHIP_STORE,
			ADVISOR_RELATIONSHIP_STORE,
			ADVISOR_CLIENT_PROFILE_STORE,
		]) {
			expect(provided).toContain(token);
		}
	});

	it('provides and exports the portfolio services', () => {
		const providers: unknown[] = Reflect.getMetadata(
			'providers',
			AdvisorModule
		);
		const exported: unknown[] = Reflect.getMetadata('exports', AdvisorModule);
		for (const service of [
			TransactionService,
			CsvImportService,
			AllocationTargetService,
			PortfolioMetricsService,
		]) {
			expect(providers).toContain(service);
			expect(exported).toContain(service);
		}
	});

	it('binds the portfolio store and market tokens', () => {
		const providers: Array<{ provide?: unknown; useExisting?: unknown }> =
			Reflect.getMetadata('providers', AdvisorModule);
		const byToken = new Map(providers.map((p) => [p.provide, p]));
		expect(byToken.has(ADVISOR_TRANSACTION_STORE)).toBe(true);
		expect(byToken.has(ADVISOR_ALLOCATION_TARGET_STORE)).toBe(true);
		expect(byToken.get(ADVISOR_PRICE_HISTORY)).toMatchObject({
			useExisting: MarketPriceHistoryAdapter,
		});
		expect(byToken.get(ADVISOR_BENCHMARK_SERIES)).toMatchObject({
			useExisting: MacroBenchmarkSeriesAdapter,
		});
	});
});
