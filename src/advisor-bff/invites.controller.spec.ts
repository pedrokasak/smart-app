import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
	ADVISOR_ASSIGNMENT_STORE,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_INVITE_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_ORG_STORE,
	ADVISOR_RELATIONSHIP_STORE,
} from 'src/advisor/application/advisor.tokens';
import { AuthorizationService } from 'src/advisor/application/authorization.service';
import { ClientDirectoryService } from 'src/advisor/application/client-directory.service';
import { ClientProfileService } from 'src/advisor/application/client-profile.service';
import {
	InMemoryAssignmentStore,
	InMemoryClientProfileStore,
	InMemoryInviteeIdentity,
	InMemoryInviteNotifier,
	InMemoryInviteStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryRelationshipStore,
} from 'src/advisor/application/in-memory-stores.fixture';
import { InviteService } from 'src/advisor/application/invite.service';
import { MembershipService } from 'src/advisor/application/membership.service';
import { OrganizationService } from 'src/advisor/application/organization.service';
import { PortalAccessService } from 'src/advisor/application/portal-access.service';
import { ADVISOR_INVITEE_IDENTITY } from 'src/advisor/application/ports/invitee-identity.port';
import { ADVISOR_INVITE_NOTIFIER } from 'src/advisor/application/ports/invite-notifier.port';
import { RelationshipService } from 'src/advisor/application/relationship.service';
import { AdvisorType, OrgRole } from 'src/advisor/domain/enums';
import { OrgContextGuard } from 'src/advisor/interface/org-context.guard';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import { jwtSecret } from 'src/env';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { OrgPortalGuard } from './org-portal.guard';
import { InvitesController } from './invites.controller';

const MISSING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EMAIL = 'joao.silva@exemplo.com';

describe('InvitesController', () => {
	let app: INestApplication;
	let jwt: JwtService;
	let orgA: string;
	let orgB: string;
	let notifier: InMemoryInviteNotifier;
	let orgs: InMemoryOrganizationStore;
	let memberships: InMemoryMembershipStore;
	const record = jest.fn();
	const hasAccess = jest.fn();

	const as = (userId: string, orgId: string) => ({
		Authorization: `Bearer ${jwt.sign({ userId, type: 'access', role: 'user' })}`,
		'x-org-id': orgId,
	});
	const A = () => as('u1', orgA);
	const B = () => as('u2', orgB);
	const http = () => request(app.getHttpServer());

	const invite = (
		headers: Record<string, string>,
		body: object = { email: EMAIL, clientName: 'Joao Silva' }
	) => http().post('/advisor/v1/invites').set(headers).send(body);

	beforeEach(async () => {
		orgs = new InMemoryOrganizationStore();
		memberships = new InMemoryMembershipStore();
		notifier = new InMemoryInviteNotifier();
		orgA = (
			await orgs.create({
				name: 'Org A',
				advisorType: AdvisorType.Assessor,
				ownerUserId: 'u1',
			})
		).id;
		orgB = (
			await orgs.create({
				name: 'Org B',
				advisorType: AdvisorType.Assessor,
				ownerUserId: 'u2',
			})
		).id;
		await memberships.create({
			userId: 'u1',
			orgId: orgA,
			role: OrgRole.OrgAdmin,
		});
		await memberships.create({
			userId: 'u2',
			orgId: orgB,
			role: OrgRole.OrgAdmin,
		});

		const moduleRef = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: jwtSecret })],
			controllers: [InvitesController],
			providers: [
				OrgContextGuard,
				OrgPortalGuard,
				OrganizationService,
				MembershipService,
				AuthorizationService,
				ClientProfileService,
				RelationshipService,
				ClientDirectoryService,
				InviteService,
				{ provide: ADVISOR_ORG_STORE, useValue: orgs },
				{
					provide: ADVISOR_INVITEE_IDENTITY,
					useValue: new InMemoryInviteeIdentity(),
				},
				{ provide: ADVISOR_MEMBERSHIP_STORE, useValue: memberships },
				{
					provide: ADVISOR_ASSIGNMENT_STORE,
					useValue: new InMemoryAssignmentStore(),
				},
				{
					provide: ADVISOR_RELATIONSHIP_STORE,
					useValue: new InMemoryRelationshipStore(),
				},
				{
					provide: ADVISOR_CLIENT_PROFILE_STORE,
					useValue: new InMemoryClientProfileStore(),
				},
				{ provide: ADVISOR_INVITE_STORE, useValue: new InMemoryInviteStore() },
				{ provide: ADVISOR_INVITE_NOTIFIER, useValue: notifier },
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
		jest.restoreAllMocks();
	});

	it('answers 401 without a JWT and 403 for a non-member or without portal access', async () => {
		await http().get('/advisor/v1/invites').expect(401);
		await http().get('/advisor/v1/invites').set(as('u1', orgB)).expect(403);
		hasAccess.mockResolvedValue(false);
		await http().get('/advisor/v1/invites').set(A()).expect(403);
	});

	describe('portal access inherited from the organization owner', () => {
		const memberHeaders = () => as('u3', orgA);

		beforeEach(async () => {
			await memberships.create({
				userId: 'u3',
				orgId: orgA,
				role: OrgRole.Advisor,
			});
			// So o dono (u1) tem liberacao; o membro (u3) nao tem plano nem liberacao.
			hasAccess.mockImplementation(async (userId: string) => userId === 'u1');
		});

		it('lets a member without plan or grant in because the owner has access', async () => {
			await http().get('/advisor/v1/invites').set(memberHeaders()).expect(200);
			expect(hasAccess).toHaveBeenCalledWith('u1');
			expect(hasAccess).not.toHaveBeenCalledWith('u3');
		});

		it('denies the whole office, member and owner, once the owner loses access', async () => {
			hasAccess.mockResolvedValue(false);
			for (const headers of [memberHeaders(), A()]) {
				const res = await http()
					.get('/advisor/v1/invites')
					.set(headers)
					.expect(403);
				expect(res.body).toEqual({
					statusCode: 403,
					error: 'PLAN_CAPABILITY_REQUIRED',
				});
			}
		});

		it('denies an organization without owner, even for a member with access of their own', async () => {
			const legacy = (
				await orgs.create({
					name: 'Legada',
					advisorType: AdvisorType.Assessor,
				})
			).id;
			await memberships.create({
				userId: 'u3',
				orgId: legacy,
				role: OrgRole.OrgAdmin,
			});
			hasAccess.mockResolvedValue(true);
			await http().get('/advisor/v1/invites').set(as('u3', legacy)).expect(403);
		});
	});

	it('creates an invite (201), sends the e-mail and lists it masked', async () => {
		const created = await invite(A()).expect(201);
		expect(created.body).toEqual({
			inviteId: expect.any(String),
			clientProfileId: expect.any(String),
			expiresAt: expect.any(String),
		});
		expect(notifier.sent).toHaveLength(1);
		expect(created.headers['cache-control']).toBe('no-store');

		const list = await http().get('/advisor/v1/invites').set(A()).expect(200);
		expect(list.body).toEqual([
			{
				id: created.body.inviteId,
				clientProfileId: created.body.clientProfileId,
				clientName: 'Joao Silva',
				invitedEmailMasked: 'jo***@ex***.com',
				expiresAt: created.body.expiresAt,
				resendCount: 0,
			},
		]);
		expect(JSON.stringify(list.body)).not.toContain(EMAIL);
		expect(JSON.stringify(list.body)).not.toContain('joao.silva');
	});

	it('answers 400 with the reason of an invalid e-mail or name', async () => {
		const email = await invite(A(), {
			email: 'not-an-email',
			clientName: 'Joao',
		}).expect(400);
		expect(email.body).toEqual({
			statusCode: 400,
			error: 'BAD_REQUEST',
			reason: 'INVALID_EMAIL',
		});
		const name = await invite(A(), { email: EMAIL, clientName: '   ' }).expect(
			400
		);
		expect(name.body.reason).toBe('INVALID_NAME');
		const tooLong = await invite(A(), {
			email: EMAIL,
			clientName: 'x'.repeat(121),
		}).expect(400);
		expect(tooLong.body.reason).toBe('INVALID_NAME');
		expect(notifier.attempts).toHaveLength(0);
	});

	it('answers 400 for a body of the wrong shape', async () => {
		await invite(A(), { email: 1, clientName: 'x' }).expect(400);
		await invite(A(), { email: EMAIL }).expect(400);
		await invite(A(), { email: EMAIL, clientName: 'x', extra: 1 }).expect(400);
	});

	it('answers 409 PENDING_INVITE for a second invite to the same e-mail', async () => {
		await invite(A()).expect(201);
		const again = await invite(A()).expect(409);
		expect(again.body).toEqual({
			statusCode: 409,
			error: 'CONFLICT',
			reason: 'PENDING_INVITE',
		});
	});

	it('resends with 200 and a new expiry, and stops at the resend limit with 409', async () => {
		const { body } = await invite(A()).expect(201);
		const url = `/advisor/v1/invites/${body.inviteId}/resend`;
		const resent = await http().post(url).set(A()).expect(200);
		expect(resent.body).toEqual({ expiresAt: expect.any(String) });
		expect(notifier.sent).toHaveLength(2);

		let last = resent;
		for (let i = 0; i < 20 && last.status === 200; i += 1) {
			last = await http().post(url).set(A());
		}
		expect(last.status).toBe(409);
		expect(last.body.reason).toBe('RESEND_LIMIT');
	});

	it('cancels with 204 and answers 409 NOT_PENDING on a second cancel or resend', async () => {
		const { body } = await invite(A()).expect(201);
		const url = `/advisor/v1/invites/${body.inviteId}`;
		await http().delete(url).set(A()).expect(204);

		const list = await http().get('/advisor/v1/invites').set(A()).expect(200);
		expect(list.body).toEqual([]);
		const again = await http().delete(url).set(A()).expect(409);
		expect(again.body.reason).toBe('NOT_PENDING');
		const resend = await http().post(`${url}/resend`).set(A()).expect(409);
		expect(resend.body.reason).toBe('NOT_PENDING');
	});

	it('answers the same 404 for a missing invite and one of another org', async () => {
		const { body } = await invite(A()).expect(201);
		const expected = { statusCode: 404, error: 'NOT_FOUND' };

		for (const id of [MISSING, body.inviteId]) {
			const resend = await http()
				.post(`/advisor/v1/invites/${id}/resend`)
				.set(B())
				.expect(404);
			expect(resend.body).toEqual(expected);
			const cancel = await http()
				.delete(`/advisor/v1/invites/${id}`)
				.set(B())
				.expect(404);
			expect(cancel.body).toEqual(expected);
		}
		const mine = await http().get('/advisor/v1/invites').set(A()).expect(200);
		expect(mine.body).toHaveLength(1);
		const theirs = await http().get('/advisor/v1/invites').set(B()).expect(200);
		expect(theirs.body).toEqual([]);
	});

	it('answers 400 for an inviteId that is not a uuid', async () => {
		await http().post('/advisor/v1/invites/abc/resend').set(A()).expect(400);
		await http().delete('/advisor/v1/invites/abc').set(A()).expect(400);
	});

	it('answers 500 without detail when the e-mail send fails, and leaves no invite', async () => {
		const logged = jest
			.spyOn(Logger.prototype, 'error')
			.mockImplementation(() => undefined);
		notifier.failWith = new Error('smtp down for joao.silva@exemplo.com');
		const res = await invite(A()).expect(500);
		expect(res.body).toEqual({
			statusCode: 500,
			error: 'INTERNAL_SERVER_ERROR',
		});
		const list = await http().get('/advisor/v1/invites').set(A()).expect(200);
		expect(list.body).toEqual([]);
		expect(logged).toHaveBeenCalled();
		const text = logged.mock.calls.flat().join('\n');
		expect(text).not.toContain('joao.silva');
		expect(text).not.toContain('smtp down');
	});
});
