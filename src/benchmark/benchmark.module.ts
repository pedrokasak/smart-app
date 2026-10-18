import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserModel } from 'src/users/schema/user.model';
import { tradeSchema } from 'src/fiscal/schema/trade.model';
import { portfolioHistorySchema } from 'src/portfolio/schema/portfolio-history.model';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import { IntelligenceModule } from 'src/intelligence/intelligence.module';
import { BenchmarkController } from 'src/benchmark/benchmark.controller';
import { CohortBenchmarkService } from 'src/benchmark/application/cohort-benchmark.service';
import { CohortBenchmarkJob } from 'src/benchmark/application/cohort-benchmark.job';
import { COHORT_SOURCE } from 'src/benchmark/application/cohort-source.port';
import { COHORT_BENCHMARK_STORE } from 'src/benchmark/application/cohort-benchmark-store.port';
import { UserCohortSourceAdapter } from 'src/benchmark/infrastructure/user-cohort-source.adapter';
import { MongoCohortBenchmarkStore } from 'src/benchmark/infrastructure/mongo-cohort-benchmark.store';
import { cohortBenchmarkSchema } from 'src/benchmark/infrastructure/cohort-benchmark.model';

/**
 * Benchmark comparativo do Score por coorte (ADR-003, TRA-60). O
 * `ScheduleModule.forRoot()` já é registrado pelo SchedulerModule.
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'User', schema: UserModel.schema },
			{ name: 'Trade', schema: tradeSchema },
			{ name: 'PortfolioHistory', schema: portfolioHistorySchema },
			{ name: 'CohortBenchmark', schema: cohortBenchmarkSchema },
		]),
		PortfolioModule,
		IntelligenceModule,
	],
	controllers: [BenchmarkController],
	providers: [
		CohortBenchmarkService,
		CohortBenchmarkJob,
		UserCohortSourceAdapter,
		{ provide: COHORT_SOURCE, useExisting: UserCohortSourceAdapter },
		MongoCohortBenchmarkStore,
		{ provide: COHORT_BENCHMARK_STORE, useExisting: MongoCohortBenchmarkStore },
	],
})
export class BenchmarkModule {}
