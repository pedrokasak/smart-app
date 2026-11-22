import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
	ADVISOR_ASSIGNMENT_STORE,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_ORG_STORE,
	ADVISOR_RELATIONSHIP_STORE,
} from 'src/advisor/application/advisor.tokens';
import { AuthorizationService } from 'src/advisor/application/authorization.service';
import {
	InMemoryAssignmentStore,
	InMemoryClientProfileStore,
	InMemoryInviteeIdentity,
	InMemoryMemberInviteStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryPortalAccountDirectory,
	InMemoryPortalGrantStore,
	InMemoryRelationshipStore,
} from 'src/advisor/application/in-memory-stores.fixture';
import {
	ADVISOR_MEMBER_INVITE_STORE,
	ADVISOR_PORTAL_GRANT_STORE,
} from 'src/advisor/application/advisor.tokens';
import { MembershipService } from 'src/advisor/application/membership.service';
import { OrganizationService } from 'src/advisor/application/organization.service';
import { PortalAccessService } from 'src/advisor/application/portal-access.service';
import { ADVISOR_INVITEE_IDENTITY } from 'src/advisor/application/ports/invitee-identity.port';
import { ADVISOR_PORTAL_ACCOUNT_DIRECTORY } from 'src/advisor/application/ports/portal-account-directory.port';
import { TeamService } from 'src/advisor/application/team.service';
import { AdvisorType, OrgRole } from 'src/advisor/domain/enums';
import { OrgContextGuard } from 'src/advisor/interface/org-context.guard';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import { jwtSecret } from 'src/env';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { MeMembershipController } from './me-membership.controller';
import { MembersController } from './members.controller';
import { OrgPortalGuard } from './org-portal.guard';

// Ids de usuário no formato do projeto (ObjectId).
const OWNER = '64b000000000000000000001';
const ADVISOR = '64b000000000000000000002';
const ADMIN = '64b000000000000000000003';
const STRANGER = '64b000000000000000000009';
const CLIENT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('MembersController', () => {
	let app: INestApplication;
	let jwt: JwtService;
	let orgId: string;
	let memberships: InMemoryMembershipStore;
	let assignments: InMemoryAssignmentStore;
	const record = jest.fn();
	const hasAccess = jest.fn();

	const as = (userId: string, org = orgId) => ({
		Authorization: `Bearer ${jwt.sign({ userId, type: 'access', role: 'user' })}`,
		'x-org-id': org,
	});
	const http = () => request(app.getHttpServer());
	const isMember = async (userId: string) =>
		(await memberships.findByUserAndOrg(userId, orgId)) !== null;

	beforeEach(async () => {
		const orgs = new InMemoryOrganizationStore();
		memberships = new InMemoryMembershipStore();
		assignments = new InMemoryAssignmentStore();
		const accounts = new InMemoryPortalAccountDirectory();
		orgId = (
			await orgs.create({
				name: 'Escritório A',
				advisorType: AdvisorType.Assessor,
				ownerUserId: OWNER,
			})
		).id;
		await memberships.create({
			userId: OWNER,
			orgId,
			role: OrgRole.OrgAdmin,
		});
		await memberships.create({
			userId: ADVISOR,
			orgId,
			role: OrgRole.Advisor,
		});
		await memberships.create({ userId: ADMIN, orgId, role: OrgRole.OrgAdmin });
		accounts.set(OWNER, 'dono@escritorio.com', 'Dona');
		accounts.set(ADVISOR, 'fulano@escritorio.com', 'Fulano');
		accounts.set(ADMIN, 'admin@escritorio.com', 'Admin');
		await assignments.assign(orgId, CLIENT, ADVISOR, OWNER);

		const moduleRef = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: jwtSecret })],
			controllers: [MembersController, MeMembershipController],
			providers: [
				OrgContextGuard,
				OrgPortalGuard,
				MembershipService,
				OrganizationService,
				AuthorizationService,
				TeamService,
				{ provide: ADVISOR_ORG_STORE, useValue: orgs },
				{ provide: ADVISOR_MEMBERSHIP_STORE, useValue: memberships },
				{ provide: ADVISOR_ASSIGNMENT_STORE, useValue: assignments },
				{
					provide: ADVISOR_RELATIONSHIP_STORE,
					useValue: new InMemoryRelationshipStore(assignments),
				},
				{
					provide: ADVISOR_CLIENT_PROFILE_STORE,
					useValue: new InMemoryClientProfileStore(),
				},
				{ provide: ADVISOR_PORTAL_ACCOUNT_DIRECTORY, useValue: accounts },
				{
					provide: ADVISOR_MEMBER_INVITE_STORE,
					useValue: new InMemoryMemberInviteStore(),
				},
				{
					provide: ADVISOR_PORTAL_GRANT_STORE,
					useValue: new InMemoryPortalGrantStore(),
				},
				{
					provide: ADVISOR_INVITEE_IDENTITY,
					useValue: new InMemoryInviteeIdentity(),
				},
				{ provide: AUDIT_TRAIL, useValue: { record } },
				{ provide: PortalAccessService, useValue: { hasAccess } },
				{
					provide: TokenBlacklistService,
					useValue: { isBlacklisted: jest.fn().mockResolvedValue(false) },
				},
			],
		}).compile();

		app = moduleRef.createNestApplication();
		// Same pipe as main.ts.
		app.useGlobalPipes(
			new ValidationPipe({
				whitelist: true,
				forbidNonWhitelisted: true,
				transform: true,
			})
		);
		await app.init();
		jwt = moduleRef.get(JwtService);
		record.mockReset().mockResolvedValue(undefined);
		hasAccess.mockReset().mockResolvedValue(true);
	});

	afterEach(async () => {
		await app.close();
	});

	it('answers 401 without a JWT and 403 without x-org-id or for a non-member', async () => {
		await http().get('/advisor/v1/members').expect(401);
		const noHeader = await http()
			.get('/advisor/v1/members')
			.set({ Authorization: as(OWNER).Authorization })
			.expect(403);
		expect(noHeader.body.reason).toBe('ORG_HEADER_REQUIRED');
		await http().get('/advisor/v1/members').set(as(STRANGER)).expect(403);
	});

	it('answers 403 PLAN_CAPABILITY_REQUIRED when the owner has no portal access', async () => {
		hasAccess.mockResolvedValue(false);
		const res = await http()
			.get('/advisor/v1/members')
			.set(as(ADVISOR))
			.expect(403);
		expect(res.body).toEqual({
			statusCode: 403,
			error: 'PLAN_CAPABILITY_REQUIRED',
		});
	});

	describe('GET /members', () => {
		it('lists the team to any member with the e-mail masked and no-store', async () => {
			const res = await http()
				.get('/advisor/v1/members')
				.set(as(ADVISOR))
				.expect(200);
			expect(res.headers['cache-control']).toContain('no-store');
			expect(res.body).toHaveLength(3);
			const owner = res.body.find((m: any) => m.userId === OWNER);
			expect(owner).toEqual({
				userId: OWNER,
				name: 'Dona',
				emailMasked: expect.any(String),
				role: OrgRole.OrgAdmin,
				joinedAt: expect.any(String),
				isOwner: true,
			});
			expect(JSON.stringify(res.body)).not.toContain('@escritorio.com');
			expect(res.body.find((m: any) => m.userId === ADVISOR).isOwner).toBe(
				false
			);
		});
	});

	describe('DELETE /members/:userId', () => {
		it('removes the member and their assignments with 204', async () => {
			await http()
				.delete(`/advisor/v1/members/${ADVISOR}`)
				.set(as(OWNER))
				.expect(204);
			expect(await isMember(ADVISOR)).toBe(false);
			expect(await assignments.listByClient(orgId, CLIENT)).toEqual([]);
			expect(record).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'advisor.member.removed',
					subject: ADVISOR,
				})
			);
		});

		it('answers 409 OWNER_CANNOT_BE_REMOVED for the owner, removing nothing', async () => {
			const res = await http()
				.delete(`/advisor/v1/members/${OWNER}`)
				.set(as(ADMIN))
				.expect(409);
			expect(res.body).toEqual({
				statusCode: 409,
				error: 'CONFLICT',
				reason: 'OWNER_CANNOT_BE_REMOVED',
			});
			expect(await isMember(OWNER)).toBe(true);
		});

		it('answers 403 ROLE_REQUIRED to an ADVISOR, removing nothing', async () => {
			const res = await http()
				.delete(`/advisor/v1/members/${ADMIN}`)
				.set(as(ADVISOR))
				.expect(403);
			expect(res.body).toEqual({
				statusCode: 403,
				error: 'FORBIDDEN',
				reason: 'ROLE_REQUIRED',
			});
			expect(await isMember(ADMIN)).toBe(true);
			expect(record).not.toHaveBeenCalled();
		});

		it('answers the bare 404 for a user who is not a member', async () => {
			const res = await http()
				.delete(`/advisor/v1/members/${STRANGER}`)
				.set(as(OWNER))
				.expect(404);
			expect(res.body).toEqual({ statusCode: 404, error: 'NOT_FOUND' });
		});

		it('answers 400 for a userId outside the project id format', async () => {
			const res = await http()
				.delete('/advisor/v1/members/not-a-user-id')
				.set(as(OWNER))
				.expect(400);
			expect(res.body.statusCode).toBe(400);
			expect(await isMember(ADVISOR)).toBe(true);
		});
	});

	describe('POST /members/:userId/promote', () => {
		it('promotes an ADVISOR and answers 200 again without change', async () => {
			for (let i = 0; i < 2; i += 1) {
				const res = await http()
					.post(`/advisor/v1/members/${ADVISOR}/promote`)
					.set(as(OWNER))
					.expect(200);
				expect(res.body).toEqual({ userId: ADVISOR, role: OrgRole.OrgAdmin });
			}
			expect((await memberships.findByUserAndOrg(ADVISOR, orgId))?.role).toBe(
				OrgRole.OrgAdmin
			);
			expect(record).toHaveBeenCalledTimes(1);
		});

		it('answers 403 ROLE_REQUIRED to an ADVISOR', async () => {
			const res = await http()
				.post(`/advisor/v1/members/${ADVISOR}/promote`)
				.set(as(ADVISOR))
				.expect(403);
			expect(res.body.reason).toBe('ROLE_REQUIRED');
		});

		it('answers 404 for a non-member and 400 for a bad id', async () => {
			await http()
				.post(`/advisor/v1/members/${STRANGER}/promote`)
				.set(as(OWNER))
				.expect(404);
			await http()
				.post('/advisor/v1/members/123/promote')
				.set(as(OWNER))
				.expect(400);
		});
	});

	describe('DELETE /me/membership', () => {
		it('lets a member leave with 204', async () => {
			await http()
				.delete('/advisor/v1/me/membership')
				.set(as(ADVISOR))
				.expect(204);
			expect(await isMember(ADVISOR)).toBe(false);
			expect(record).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'advisor.member.left' })
			);
		});

		it('lets a member leave an office whose owner has no portal access (R10)', async () => {
			hasAccess.mockResolvedValue(false);
			const blocked = await http()
				.get('/advisor/v1/members')
				.set(as(ADVISOR))
				.expect(403);
			expect(blocked.body).toEqual({
				statusCode: 403,
				error: 'PLAN_CAPABILITY_REQUIRED',
			});
			await http()
				.delete('/advisor/v1/me/membership')
				.set(as(ADVISOR))
				.expect(204);
			expect(await isMember(ADVISOR)).toBe(false);
		});

		it('answers 403 without x-org-id or for a non-member', async () => {
			const res = await http()
				.delete('/advisor/v1/me/membership')
				.set({ Authorization: as(ADVISOR).Authorization })
				.expect(403);
			expect(res.body.reason).toBe('ORG_HEADER_REQUIRED');
			await http()
				.delete('/advisor/v1/me/membership')
				.set(as(STRANGER))
				.expect(403);
		});

		it('answers 409 OWNER_CANNOT_LEAVE to the owner', async () => {
			const res = await http()
				.delete('/advisor/v1/me/membership')
				.set(as(OWNER))
				.expect(409);
			expect(res.body.reason).toBe('OWNER_CANNOT_LEAVE');
			expect(await isMember(OWNER)).toBe(true);
		});
	});
});
