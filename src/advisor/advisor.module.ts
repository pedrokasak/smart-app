import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MacroIndicatorsModule } from 'src/macro-indicators/macro-indicators.module';
import { MarketDataModule } from 'src/market-data/market-data.module';
import { EmailModule } from 'src/notifications/email/email.module';
import { PortfolioSharingReadModule } from 'src/portfolio/sharing/portfolio-sharing-read.module';
import { UsersModule } from 'src/users/users.module';
import {
	ADVISOR_ALLOCATION_TARGET_STORE,
	ADVISOR_BENCHMARK_SERIES,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_CONSENT_STORE,
	ADVISOR_INVITE_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_ORG_STORE,
	ADVISOR_PRICE_HISTORY,
	ADVISOR_RELATIONSHIP_STORE,
	ADVISOR_TRANSACTION_STORE,
} from './application/advisor.tokens';
import { AllocationTargetService } from './application/allocation-target.service';
import { AuthorizationService } from './application/authorization.service';
import { ClientProfileService } from './application/client-profile.service';
import { ConsentService } from './application/consent.service';
import { CsvImportService } from './application/csv/csv-import.service';
import { InviteService } from './application/invite.service';
import { MembershipService } from './application/membership.service';
import { PortfolioMetricsService } from './application/metrics/portfolio-metrics.service';
import { OrganizationService } from './application/organization.service';
import { ADVISOR_INVITE_NOTIFIER } from './application/ports/invite-notifier.port';
import { ADVISOR_INVITEE_IDENTITY } from './application/ports/invitee-identity.port';
import { ADVISOR_SHARED_PORTFOLIO_SOURCE } from './application/ports/shared-portfolio-source.port';
import { RelationshipService } from './application/relationship.service';
import { SharedPortfolioService } from './application/shared-portfolio.service';
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
import {
	ADVISOR_CLIENT_INVITE_MODEL,
	ADVISOR_CONSENT_MODEL,
	advisorConsentSchemas,
} from './infrastructure/advisor-consent.models';
import { B2cSharedPortfolioSourceAdapter } from './infrastructure/b2c-shared-portfolio-source.adapter';
import { EmailInviteNotifierAdapter } from './infrastructure/email-invite-notifier.adapter';
import { MacroBenchmarkSeriesAdapter } from './infrastructure/macro-benchmark-series.adapter';
import { MarketPriceHistoryAdapter } from './infrastructure/market-price-history.adapter';
import { MongoAllocationTargetStore } from './infrastructure/mongo-allocation-target.store';
import { MongoClientProfileStore } from './infrastructure/mongo-client-profile.store';
import { MongoConsentStore } from './infrastructure/mongo-consent.store';
import { MongoInviteStore } from './infrastructure/mongo-invite.store';
import { MongoMembershipStore } from './infrastructure/mongo-membership.store';
import { MongoOrganizationStore } from './infrastructure/mongo-organization.store';
import { MongoRelationshipStore } from './infrastructure/mongo-relationship.store';
import { MongoTransactionStore } from './infrastructure/mongo-transaction.store';
import { UserInviteeIdentityAdapter } from './infrastructure/user-invitee-identity.adapter';
import { AdvisorAccessController } from './interface/advisor-access.controller';
import { OrgContextGuard } from './interface/org-context.guard';

/**
 * Fundacao do Trackerr Advisor: organizacoes, vinculos, relacoes com clientes,
 * autorizacao por org, convite e consentimento do investidor. O unico
 * controller e o do investidor (`/me/advisor-access`); o BFF do assessor vem
 * depois. Dado B2C so entra por `PortfolioSharingReadModule`.
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
			{
				name: ADVISOR_CLIENT_INVITE_MODEL,
				schema: advisorConsentSchemas.clientInvite,
			},
			{ name: ADVISOR_CONSENT_MODEL, schema: advisorConsentSchemas.consent },
		]),
		MarketDataModule,
		MacroIndicatorsModule,
		PortfolioSharingReadModule,
		EmailModule,
		UsersModule,
	],
	controllers: [AdvisorAccessController],
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
		MongoInviteStore,
		MongoConsentStore,
		EmailInviteNotifierAdapter,
		UserInviteeIdentityAdapter,
		B2cSharedPortfolioSourceAdapter,
		{ provide: ADVISOR_INVITE_STORE, useExisting: MongoInviteStore },
		{ provide: ADVISOR_CONSENT_STORE, useExisting: MongoConsentStore },
		{
			provide: ADVISOR_INVITE_NOTIFIER,
			useExisting: EmailInviteNotifierAdapter,
		},
		{
			provide: ADVISOR_INVITEE_IDENTITY,
			useExisting: UserInviteeIdentityAdapter,
		},
		{
			provide: ADVISOR_SHARED_PORTFOLIO_SOURCE,
			useExisting: B2cSharedPortfolioSourceAdapter,
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
		InviteService,
		ConsentService,
		SharedPortfolioService,
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
		InviteService,
		ConsentService,
		SharedPortfolioService,
		OrgContextGuard,
	],
})
export class AdvisorModule {}
