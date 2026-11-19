import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MacroIndicatorsModule } from 'src/macro-indicators/macro-indicators.module';
import { MarketDataModule } from 'src/market-data/market-data.module';
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
import { AuthorizationService } from './application/authorization.service';
import { ClientProfileService } from './application/client-profile.service';
import { CsvImportService } from './application/csv/csv-import.service';
import { MembershipService } from './application/membership.service';
import { PortfolioMetricsService } from './application/metrics/portfolio-metrics.service';
import { OrganizationService } from './application/organization.service';
import { RelationshipService } from './application/relationship.service';
import { TransactionService } from './application/transaction.service';
import {
	ADVISOR_CLIENT_PROFILE_MODEL,
	ADVISOR_MEMBERSHIP_MODEL,
	ADVISOR_ORGANIZATION_MODEL,
	ADVISOR_RELATIONSHIP_MODEL,
	advisorSchemas,
} from './infrastructure/advisor.models';
import {
	ADVISOR_ALLOCATION_TARGET_MODEL,
	ADVISOR_IMPORT_BATCH_MODEL,
	ADVISOR_TRANSACTION_MODEL,
	advisorPortfolioSchemas,
} from './infrastructure/advisor-portfolio.models';
import { MacroBenchmarkSeriesAdapter } from './infrastructure/macro-benchmark-series.adapter';
import { MarketPriceHistoryAdapter } from './infrastructure/market-price-history.adapter';
import { MongoAllocationTargetStore } from './infrastructure/mongo-allocation-target.store';
import { MongoClientProfileStore } from './infrastructure/mongo-client-profile.store';
import { MongoMembershipStore } from './infrastructure/mongo-membership.store';
import { MongoOrganizationStore } from './infrastructure/mongo-organization.store';
import { MongoRelationshipStore } from './infrastructure/mongo-relationship.store';
import { MongoTransactionStore } from './infrastructure/mongo-transaction.store';
import { OrgContextGuard } from './interface/org-context.guard';

/**
 * Fundacao do Trackerr Advisor: organizacoes, vinculos, relacoes com clientes
 * e autorizacao por org. Sem controllers nesta fase (o BFF vem depois).
 * `AUDIT_TRAIL` vem do `AuditModule` global.
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: ADVISOR_ORGANIZATION_MODEL, schema: advisorSchemas.organization },
			{ name: ADVISOR_MEMBERSHIP_MODEL, schema: advisorSchemas.membership },
			{
				name: ADVISOR_RELATIONSHIP_MODEL,
				schema: advisorSchemas.relationship,
			},
			{
				name: ADVISOR_CLIENT_PROFILE_MODEL,
				schema: advisorSchemas.clientProfile,
			},
			{
				name: ADVISOR_TRANSACTION_MODEL,
				schema: advisorPortfolioSchemas.transaction,
			},
			{
				name: ADVISOR_IMPORT_BATCH_MODEL,
				schema: advisorPortfolioSchemas.importBatch,
			},
			{
				name: ADVISOR_ALLOCATION_TARGET_MODEL,
				schema: advisorPortfolioSchemas.allocationTarget,
			},
		]),
		MarketDataModule,
		MacroIndicatorsModule,
	],
	providers: [
		MongoOrganizationStore,
		MongoMembershipStore,
		MongoRelationshipStore,
		MongoClientProfileStore,
		{ provide: ADVISOR_ORG_STORE, useExisting: MongoOrganizationStore },
		{ provide: ADVISOR_MEMBERSHIP_STORE, useExisting: MongoMembershipStore },
		{
			provide: ADVISOR_RELATIONSHIP_STORE,
			useExisting: MongoRelationshipStore,
		},
		{
			provide: ADVISOR_CLIENT_PROFILE_STORE,
			useExisting: MongoClientProfileStore,
		},
		MongoTransactionStore,
		MongoAllocationTargetStore,
		MarketPriceHistoryAdapter,
		MacroBenchmarkSeriesAdapter,
		{ provide: ADVISOR_TRANSACTION_STORE, useExisting: MongoTransactionStore },
		{
			provide: ADVISOR_ALLOCATION_TARGET_STORE,
			useExisting: MongoAllocationTargetStore,
		},
		{ provide: ADVISOR_PRICE_HISTORY, useExisting: MarketPriceHistoryAdapter },
		{
			provide: ADVISOR_BENCHMARK_SERIES,
			useExisting: MacroBenchmarkSeriesAdapter,
		},
		OrganizationService,
		MembershipService,
		RelationshipService,
		ClientProfileService,
		AuthorizationService,
		TransactionService,
		CsvImportService,
		AllocationTargetService,
		PortfolioMetricsService,
		OrgContextGuard,
	],
	exports: [
		TransactionService,
		CsvImportService,
		AllocationTargetService,
		PortfolioMetricsService,
		AuthorizationService,
		MembershipService,
		OrganizationService,
		RelationshipService,
		ClientProfileService,
		OrgContextGuard,
	],
})
export class AdvisorModule {}
