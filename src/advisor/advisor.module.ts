import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { advisorWebUrl } from 'src/env';
import { MacroIndicatorsModule } from 'src/macro-indicators/macro-indicators.module';
import { MarketDataModule } from 'src/market-data/market-data.module';
import { EmailModule } from 'src/notifications/email/email.module';
import { PortfolioSharingReadModule } from 'src/portfolio/sharing/portfolio-sharing-read.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { UsersModule } from 'src/users/users.module';
import {
	ADVISOR_ALLOCATION_TARGET_STORE,
	ADVISOR_ASSIGNMENT_STORE,
	ADVISOR_BENCHMARK_SERIES,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_CONSENT_STORE,
	ADVISOR_INVITE_STORE,
	ADVISOR_MEMBER_INVITE_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_ORG_STORE,
	ADVISOR_PORTAL_GRANT_STORE,
	ADVISOR_PRICE_HISTORY,
	ADVISOR_RELATIONSHIP_STORE,
	ADVISOR_TRANSACTION_STORE,
} from './application/advisor.tokens';
import { AllocationTargetService } from './application/allocation-target.service';
import { AuthorizationService } from './application/authorization.service';
import { ClientDirectoryService } from './application/client-directory.service';
import { ClientProfileService } from './application/client-profile.service';
import { ConsentService } from './application/consent.service';
import { CsvImportService } from './application/csv/csv-import.service';
import { InviteService } from './application/invite.service';
import { MemberInviteService } from './application/member-invite.service';
import { MembershipService } from './application/membership.service';
import { PortfolioMetricsService } from './application/metrics/portfolio-metrics.service';
import { OrganizationService } from './application/organization.service';
import { ADVISOR_INVITE_NOTIFIER } from './application/ports/invite-notifier.port';
import { ADVISOR_INVITEE_IDENTITY } from './application/ports/invitee-identity.port';
import { ADVISOR_MEMBER_INVITE_NOTIFIER } from './application/ports/member-invite-notifier.port';
import { ADVISOR_PORTAL_ACCOUNT_DIRECTORY } from './application/ports/portal-account-directory.port';
import { ADVISOR_SHARED_PORTFOLIO_SOURCE } from './application/ports/shared-portfolio-source.port';
import { PortalAccessService } from './application/portal-access.service';
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
import {
	ADVISOR_PORTAL_GRANT_MODEL,
	advisorPortalGrantSchema,
} from './infrastructure/advisor-portal-grant.models';
import {
	ADVISOR_CLIENT_ASSIGNMENT_MODEL,
	ADVISOR_MEMBER_INVITE_MODEL,
	advisorTeamSchemas,
} from './infrastructure/advisor-team.models';
import { B2cSharedPortfolioSourceAdapter } from './infrastructure/b2c-shared-portfolio-source.adapter';
import { EmailInviteNotifierAdapter } from './infrastructure/email-invite-notifier.adapter';
import {
	ADVISOR_WEB_URL,
	EmailMemberInviteNotifierAdapter,
} from './infrastructure/email-member-invite-notifier.adapter';
import { MacroBenchmarkSeriesAdapter } from './infrastructure/macro-benchmark-series.adapter';
import { MarketPriceHistoryAdapter } from './infrastructure/market-price-history.adapter';
import { MongoAllocationTargetStore } from './infrastructure/mongo-allocation-target.store';
import { MongoAssignmentStore } from './infrastructure/mongo-assignment.store';
import { MongoClientProfileStore } from './infrastructure/mongo-client-profile.store';
import { MongoConsentStore } from './infrastructure/mongo-consent.store';
import { MongoInviteStore } from './infrastructure/mongo-invite.store';
import { MongoMemberInviteStore } from './infrastructure/mongo-member-invite.store';
import { MongoMembershipStore } from './infrastructure/mongo-membership.store';
import { MongoOrganizationStore } from './infrastructure/mongo-organization.store';
import { MongoPortalGrantStore } from './infrastructure/mongo-portal-grant.store';
import { MongoRelationshipStore } from './infrastructure/mongo-relationship.store';
import { MongoTransactionStore } from './infrastructure/mongo-transaction.store';
import { UserInviteeIdentityAdapter } from './infrastructure/user-invitee-identity.adapter';
import { UserPortalAccountDirectoryAdapter } from './infrastructure/user-portal-account-directory.adapter';
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
			{ name: ADVISOR_PORTAL_GRANT_MODEL, schema: advisorPortalGrantSchema },
			{
				name: ADVISOR_CLIENT_ASSIGNMENT_MODEL,
				schema: advisorTeamSchemas.assignment,
			},
			{
				name: ADVISOR_MEMBER_INVITE_MODEL,
				schema: advisorTeamSchemas.memberInvite,
			},
		]),
		MarketDataModule,
		MacroIndicatorsModule,
		PortfolioSharingReadModule,
		EmailModule,
		UsersModule,
		// `USER_PLAN_RESOLVER` para a capability `advisor.portal` (P3a, U4).
		SubscriptionModule,
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
		MongoAssignmentStore,
		MongoMemberInviteStore,
		{ provide: ADVISOR_ASSIGNMENT_STORE, useExisting: MongoAssignmentStore },
		{
			provide: ADVISOR_MEMBER_INVITE_STORE,
			useExisting: MongoMemberInviteStore,
		},
		// Sem ADVISOR_WEB_URL o notifier lança e o convite de membro é desfeito.
		{ provide: ADVISOR_WEB_URL, useFactory: () => advisorWebUrl ?? null },
		EmailMemberInviteNotifierAdapter,
		{
			provide: ADVISOR_MEMBER_INVITE_NOTIFIER,
			useExisting: EmailMemberInviteNotifierAdapter,
		},
		MongoPortalGrantStore,
		UserPortalAccountDirectoryAdapter,
		{ provide: ADVISOR_PORTAL_GRANT_STORE, useExisting: MongoPortalGrantStore },
		{
			provide: ADVISOR_PORTAL_ACCOUNT_DIRECTORY,
			useExisting: UserPortalAccountDirectoryAdapter,
		},
		PortalAccessService,
		OrganizationService,
		MembershipService,
		RelationshipService,
		ClientProfileService,
		ClientDirectoryService,
		AuthorizationService,
		TransactionService,
		CsvImportService,
		AllocationTargetService,
		PortfolioMetricsService,
		InviteService,
		MemberInviteService,
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
		ClientDirectoryService,
		InviteService,
		MemberInviteService,
		ConsentService,
		SharedPortfolioService,
		OrgContextGuard,
		PortalAccessService,
	],
})
export class AdvisorModule {}
