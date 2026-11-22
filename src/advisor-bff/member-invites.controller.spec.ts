import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
	ADVISOR_ASSIGNMENT_STORE,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_MEMBER_INVITE_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_ORG_STORE,
	ADVISOR_RELATIONSHIP_STORE,
} from 'src/advisor/application/advisor.tokens';
import { AuthorizationService } from 'src/advisor/application/authorization.service';
import {
	InMemoryAssignmentStore,
	InMemoryClientProfileStore,
	InMemoryInviteeIdentity,
	InMemoryMemberInviteNotifier,
	InMemoryMemberInviteStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryPortalAccountDirectory,
	InMemoryRelationshipStore,
} from 'src/advisor/application/in-memory-stores.fixture';
import { MemberInviteService } from 'src/advisor/application/member-invite.service';
import { MembershipService } from 'src/advisor/application/membership.service';
import { OrganizationService } from 'src/advisor/application/organization.service';
import { PortalAccessService } from 'src/advisor/application/portal-access.service';
import { ADVISOR_INVITEE_IDENTITY } from 'src/advisor/application/ports/invitee-identity.port';
import { ADVISOR_MEMBER_INVITE_NOTIFIER } from 'src/advisor/application/ports/member-invite-notifier.port';
import { ADVISOR_PORTAL_ACCOUNT_DIRECTORY } from 'src/advisor/application/ports/portal-account-directory.port';
import { AdvisorType, OrgRole } from 'src/advisor/domain/enums';
import { OrgContextGuard } from 'src/advisor/interface/org-context.guard';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import { jwtSecret } from 'src/env';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { MemberInvitesController } from './member-invites.controller';
import { OrgPortalGuard } from './org-portal.guard';

const OWNER = '64b000000000000000000001';
const ADVISOR = '64b000000000000000000002';
const OTHER_OWNER = '64b000000000000000000008';
const MISSING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EMAIL = 'fulano@exemplo.com';

describe('MemberInvitesController', () => {
	let app: INestApplication;
	let jwt: JwtService;
	let orgId: string;
	let otherOrgId: string;
	let notifier: InMemoryMemberInviteNotifier;
	const record = jest.fn();
	const hasAccess = jest.fn();

	const as = (userId: string, org = orgId) => ({
		Authorization: `Bearer ${jwt.sign({ userId, type: 'access', role: 'user' })}`,
		'x-org-id': org,
	});
	const http = () => request(app.getHttpServer());
	const invite = (body: object = { email: EMAIL }, headers = as(OWNER)) =>
		http().post('/advisor/v1/member-invites').set(headers).send(body);

	beforeEach(async () => {
		const orgs = new InMemoryOrganizationStore();
		const memberships = new InMemoryMembershipStore();
		const assignments = new InMemoryAssignmentStore();
		const accounts = new InMemoryPortalAccountDirectory();
		notifier = new InMemoryMemberInviteNotifier();
		orgId = (
			await orgs.create({
				name: 'Escritório A',
				advisorType: AdvisorType.Assessor,
				ownerUserId: OWNER,
			})
		).id;
		otherOrgId = (
			await orgs.create({
				name: 'Escritório B',
				advisorType: AdvisorType.Assessor,
				ownerUserId: OTHER_OWNER,
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
		await memberships.create({
			userId: OTHER_OWNER,
			orgId: otherOrgId,
			role: OrgRole.OrgAdmin,
		});
		accounts.set(ADVISOR, 'membro@exemplo.com', 'Membro');

		const moduleRef = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: jwtSecret })],
			controllers: [MemberInvitesController],
			providers: [
				OrgContextGuard,
				OrgPortalGuard,
				MembershipService,
				OrganizationService,
				AuthorizationService,
				MemberInviteService,
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
				{
					provide: ADVISOR_MEMBER_INVITE_STORE,
					useValue: new InMemoryMemberInviteStore(),
				},
				{ provide: ADVISOR_MEMBER_INVITE_NOTIFIER, useValue: notifier },
				{ provide: ADVISOR_PORTAL_ACCOUNT_DIRECTORY, useValue: accounts },
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

	it('answers 401 without a JWT and 403 for a non-member', async () => {
		await http().get('/advisor/v1/member-invites').expect(401);
		await http()
			.get('/advisor/v1/member-invites')
			.set(as(OWNER, otherOrgId))
			.expect(403);
	});

	it('answers 403 ROLE_REQUIRED to an ADVISOR on every route, without sending', async () => {
		const created = await invite().expect(201);
		const id = created.body.inviteId;
		notifier.sent.length = 0;
		// Supertest abre o servidor ao montar a requisição: montar uma por vez.
		const calls = [
			() => http().get('/advisor/v1/member-invites').set(as(ADVISOR)),
			() => invite({ email: 'outro@exemplo.com' }, as(ADVISOR)),
			() =>
				http().post(`/advisor/v1/member-invites/${id}/resend`).set(as(ADVISOR)),
			() => http().delete(`/advisor/v1/member-invites/${id}`).set(as(ADVISOR)),
		];
		for (const call of calls) {
			const res = await call().expect(403);
			expect(res.body).toEqual({
				statusCode: 403,
				error: 'FORBIDDEN',
				reason: 'ROLE_REQUIRED',
			});
		}
		expect(notifier.sent).toEqual([]);
	});

	describe('POST /member-invites', () => {
		it('creates the invite with 201 and the same body for an e-mail without account', async () => {
			const res = await invite().expect(201);
			expect(res.body).toEqual({
				inviteId: expect.any(String),
				expiresAt: expect.any(String),
			});
			expect(notifier.sent).toHaveLength(1);
			expect(record).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'advisor.member.invited' })
			);
		});

		it('answers 409 PENDING_INVITE for a second invite to the same e-mail', async () => {
			await invite().expect(201);
			const res = await invite({ email: 'FULANO@exemplo.com' }).expect(409);
			expect(res.body).toEqual({
				statusCode: 409,
				error: 'CONFLICT',
				reason: 'PENDING_INVITE',
			});
		});

		it('answers 409 ALREADY_MEMBER for the e-mail of a member', async () => {
			const res = await invite({ email: 'membro@exemplo.com' }).expect(409);
			expect(res.body.reason).toBe('ALREADY_MEMBER');
		});

		it('answers 400 INVALID_EMAIL and 400 VALIDATION_FAILED for an unknown field', async () => {
			const bad = await invite({ email: 'nao-e-email' }).expect(400);
			expect(bad.body.reason).toBe('INVALID_EMAIL');
			const extra = await invite({ email: EMAIL, role: 'ORG_ADMIN' }).expect(
				400
			);
			expect(extra.body).toEqual({
				statusCode: 400,
				error: 'BAD_REQUEST',
				reason: 'VALIDATION_FAILED',
			});
			expect(notifier.sent).toEqual([]);
		});
	});

	describe('GET /member-invites', () => {
		it('lists the pending invites with the e-mail masked only', async () => {
			await invite().expect(201);
			const res = await http()
				.get('/advisor/v1/member-invites')
				.set(as(OWNER))
				.expect(200);
			expect(res.headers['cache-control']).toContain('no-store');
			expect(res.body).toEqual([
				{
					id: expect.any(String),
					emailMasked: expect.any(String),
					expiresAt: expect.any(String),
					resendCount: 0,
					invitedBy: OWNER,
				},
			]);
			expect(JSON.stringify(res.body)).not.toContain(EMAIL);
		});
	});

	describe('resend and cancel', () => {
		it('resends 3 times with 200 and then answers 409 RESEND_LIMIT', async () => {
			const id = (await invite().expect(201)).body.inviteId;
			for (let i = 0; i < 3; i += 1) {
				const res = await http()
					.post(`/advisor/v1/member-invites/${id}/resend`)
					.set(as(OWNER))
					.expect(200);
				expect(res.body).toEqual({ expiresAt: expect.any(String) });
			}
			const res = await http()
				.post(`/advisor/v1/member-invites/${id}/resend`)
				.set(as(OWNER))
				.expect(409);
			expect(res.body.reason).toBe('RESEND_LIMIT');
		});

		it('cancels with 204, then answers 409 NOT_PENDING', async () => {
			const id = (await invite().expect(201)).body.inviteId;
			await http()
				.delete(`/advisor/v1/member-invites/${id}`)
				.set(as(OWNER))
				.expect(204);
			const again = await http()
				.delete(`/advisor/v1/member-invites/${id}`)
				.set(as(OWNER))
				.expect(409);
			expect(again.body.reason).toBe('NOT_PENDING');
			const resend = await http()
				.post(`/advisor/v1/member-invites/${id}/resend`)
				.set(as(OWNER))
				.expect(409);
			expect(resend.body.reason).toBe('NOT_PENDING');
		});

		it('answers the bare 404 for an invite of another org or missing, 400 for a bad id', async () => {
			const id = (await invite().expect(201)).body.inviteId;
			for (const call of [
				() =>
					http()
						.post(`/advisor/v1/member-invites/${id}/resend`)
						.set(as(OTHER_OWNER, otherOrgId)),
				() =>
					http()
						.delete(`/advisor/v1/member-invites/${id}`)
						.set(as(OTHER_OWNER, otherOrgId)),
				() =>
					http().delete(`/advisor/v1/member-invites/${MISSING}`).set(as(OWNER)),
			]) {
				const res = await call().expect(404);
				expect(res.body).toEqual({ statusCode: 404, error: 'NOT_FOUND' });
			}
			await http()
				.delete('/advisor/v1/member-invites/not-a-uuid')
				.set(as(OWNER))
				.expect(400);
		});
	});
});
