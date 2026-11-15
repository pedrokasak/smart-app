import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_ORG_STORE,
	ADVISOR_RELATIONSHIP_STORE,
} from './application/advisor.tokens';
import { AuthorizationService } from './application/authorization.service';
import { ClientProfileService } from './application/client-profile.service';
import { MembershipService } from './application/membership.service';
import { OrganizationService } from './application/organization.service';
import { RelationshipService } from './application/relationship.service';
import {
	ADVISOR_CLIENT_PROFILE_MODEL,
	ADVISOR_MEMBERSHIP_MODEL,
	ADVISOR_ORGANIZATION_MODEL,
	ADVISOR_RELATIONSHIP_MODEL,
	advisorSchemas,
} from './infrastructure/advisor.models';
import { MongoClientProfileStore } from './infrastructure/mongo-client-profile.store';
import { MongoMembershipStore } from './infrastructure/mongo-membership.store';
import { MongoOrganizationStore } from './infrastructure/mongo-organization.store';
import { MongoRelationshipStore } from './infrastructure/mongo-relationship.store';
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
		]),
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
		OrganizationService,
		MembershipService,
		RelationshipService,
		ClientProfileService,
		AuthorizationService,
		OrgContextGuard,
	],
	exports: [
		AuthorizationService,
		MembershipService,
		OrganizationService,
		RelationshipService,
		ClientProfileService,
		OrgContextGuard,
	],
})
export class AdvisorModule {}
