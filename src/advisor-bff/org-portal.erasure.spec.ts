import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import {
	FREE_ACCESS_LEVEL,
	PlanAccess,
	UserPlanResolverPort,
} from 'src/subscription/application/user-plan.types';
import { AuthorizationService } from 'src/advisor/application/authorization.service';
import {
	InMemoryAssignmentStore,
	InMemoryClientProfileStore,
	InMemoryMemberInviteStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryPortalAccountDirectory,
	InMemoryPortalGrantStore,
	InMemoryRelationshipStore,
} from 'src/advisor/application/in-memory-stores.fixture';
import { MembershipService } from 'src/advisor/application/membership.service';
import { OrganizationService } from 'src/advisor/application/organization.service';
import { PortalAccessService } from 'src/advisor/application/portal-access.service';
import { TeamService } from 'src/advisor/application/team.service';
import { AdvisorType, OrgRole } from 'src/advisor/domain/enums';
import { OrgPortalGuard } from './org-portal.guard';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

const OWNER = 'owner-1';
const MEMBER = 'member-1';
const ADMIN = 'admin-9';

/** Plano sem `advisor.portal`: só a liberação do admin abre o portal. */
class FreePlans implements UserPlanResolverPort {
	async resolve(): Promise<number> {
		return FREE_ACCESS_LEVEL;
	}

	async resolveWithCapabilities(): Promise<PlanAccess> {
		return { tier: FREE_ACCESS_LEVEL, capabilities: [] };
	}
}

const ctxOf = (orgId: string): ExecutionContext =>
	({
		switchToHttp: () => ({
			getRequest: () => ({
				user: { userId: MEMBER },
				orgContext: { orgId, role: OrgRole.Advisor },
			}),
		}),
	}) as unknown as ExecutionContext;

/** E6: a exclusão da conta do dono fecha o portal do escritório (403). */
describe('exclusão da conta do dono e OrgPortalGuard (E6)', () => {
	let portalGrants: InMemoryPortalGrantStore;
	let team: TeamService;
	let guard: OrgPortalGuard;
	let orgId: string;

	beforeEach(async () => {
		const memberships = new InMemoryMembershipStore();
		const assignments = new InMemoryAssignmentStore();
		const orgs = new InMemoryOrganizationStore();
		portalGrants = new InMemoryPortalGrantStore();
		const audit: AuditTrail = { record: async () => undefined };
		const organizations = new OrganizationService(
			orgs,
			new MembershipService(memberships),
			undefined as never,
			audit
		);
		const org = await orgs.create({
			name: 'Escritório A',
			advisorType: AdvisorType.Assessor,
			ownerUserId: OWNER,
		});
		orgId = org.id;
		await memberships.create({ userId: OWNER, orgId, role: OrgRole.OrgAdmin });
		await memberships.create({ userId: MEMBER, orgId, role: OrgRole.Advisor });
		await portalGrants.grant(OWNER, ADMIN, new Date());

		team = new TeamService(
			new AuthorizationService(
				memberships,
				new InMemoryRelationshipStore(assignments),
				new InMemoryClientProfileStore(),
				assignments,
				audit
			),
			organizations,
			memberships,
			assignments,
			new InMemoryPortalAccountDirectory(),
			audit,
			new InMemoryMemberInviteStore(),
			portalGrants
		);
		guard = new OrgPortalGuard(
			organizations,
			new PortalAccessService(
				portalGrants,
				new InMemoryPortalAccountDirectory(),
				new FreePlans(),
				{ emit: () => undefined }
			)
		);
	});

	it('com a liberação do admin, o escritório entra no portal', async () => {
		await expect(guard.canActivate(ctxOf(orgId))).resolves.toBe(true);
	});

	it('dono com liberação exclui a conta: termina sem erro e o escritório recebe 403', async () => {
		await expect(
			team.eraseUser(OWNER, 'dono@escritorio.com')
		).resolves.toMatchObject({ memberships: 1, portalGrants: 1 });

		const error = await guard.canActivate(ctxOf(orgId)).catch((e) => e);
		expect(error).toBeInstanceOf(ForbiddenException);
		expect(error.getResponse()).toMatchObject({
			statusCode: 403,
			error: 'PLAN_CAPABILITY_REQUIRED',
			capability: 'advisor.portal',
		});
	});
});
