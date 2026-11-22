import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
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
import { ADVISOR_INVITEE_IDENTITY } from 'src/advisor/application/ports/invitee-identity.port';
import { ADVISOR_MEMBER_INVITE_NOTIFIER } from 'src/advisor/application/ports/member-invite-notifier.port';
import { ADVISOR_PORTAL_ACCOUNT_DIRECTORY } from 'src/advisor/application/ports/portal-account-directory.port';
import { generateInviteToken } from 'src/advisor/domain/invite-rules';
import {
	AdvisorType,
	MemberInviteStatus,
	OrgRole,
} from 'src/advisor/domain/enums';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import { jwtSecret } from 'src/env';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { MeMemberInvitesController } from './me-member-invites.controller';

const OWNER = '64b000000000000000000001';
const INVITEE = '64b000000000000000000005';
const OTHER = '64b000000000000000000006';
const NOT_FOUND = { statusCode: 404, error: 'NOT_FOUND' };

describe('MeMemberInvitesController', () => {
	let app: INestApplication;
	let jwt: JwtService;
	let orgId: string;
	let service: MemberInviteService;
	let invites: InMemoryMemberInviteStore;
	let memberships: InMemoryMembershipStore;
	let notifier: InMemoryMemberInviteNotifier;
	const record = jest.fn();

	const auth = (userId: string) => ({
		Authorization: `Bearer ${jwt.sign({ userId, type: 'access', role: 'user' })}`,
	});
	const http = () => request(app.getHttpServer());
	const post = (
		action: 'preview' | 'accept' | 'decline',
		body: object,
		userId = INVITEE
	) =>
		http()
			.post(`/advisor/v1/me/member-invites/${action}`)
			.set(auth(userId))
			.send(body);

	/** Convite do dono para o e-mail do convidado; devolve o token do e-mail. */
	const inviteToken = async (email = 'Fulano@X.com'): Promise<string> => {
		await service.createInvite({ userId: OWNER, orgId }, { email });
		return notifier.sent[notifier.sent.length - 1].token;
	};

	beforeEach(async () => {
		const orgs = new InMemoryOrganizationStore();
		memberships = new InMemoryMembershipStore();
		invites = new InMemoryMemberInviteStore();
		notifier = new InMemoryMemberInviteNotifier();
		const assignments = new InMemoryAssignmentStore();
		const identity = new InMemoryInviteeIdentity();
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
		// Conta criada depois do convite, com o e-mail em outra caixa (E5).
		identity.set(INVITEE, { email: 'fulano@x.com', emailVerified: false });
		identity.set(OTHER, { email: 'outro@x.com', emailVerified: true });

		const moduleRef = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: jwtSecret })],
			controllers: [MeMemberInvitesController],
			providers: [
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
				{ provide: ADVISOR_MEMBER_INVITE_STORE, useValue: invites },
				{ provide: ADVISOR_MEMBER_INVITE_NOTIFIER, useValue: notifier },
				{
					provide: ADVISOR_PORTAL_ACCOUNT_DIRECTORY,
					useValue: new InMemoryPortalAccountDirectory(),
				},
				{ provide: ADVISOR_INVITEE_IDENTITY, useValue: identity },
				{ provide: AUDIT_TRAIL, useValue: { record } },
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
		service = moduleRef.get(MemberInviteService);
		record.mockReset().mockResolvedValue(undefined);
	});

	afterEach(async () => {
		await app.close();
	});

	it('runs main.ts with forbidNonWhitelisted, which the query rejection relies on', () => {
		const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
		expect(main).toMatch(
			/new ValidationPipe\(\{[^}]*whitelist: true,[^}]*forbidNonWhitelisted: true/
		);
	});

	it('answers 401 without a JWT and needs no x-org-id nor membership', async () => {
		const token = await inviteToken();
		await http()
			.post('/advisor/v1/me/member-invites/preview')
			.send({ token })
			.expect(401);
		await post('preview', { token }).expect(200);
	});

	describe('POST /me/member-invites/preview', () => {
		it('shows the office and the masked e-mail, with no-store', async () => {
			const token = await inviteToken();
			const res = await post('preview', { token }).expect(200);
			expect(res.headers['cache-control']).toContain('no-store');
			expect(res.body).toEqual({
				organizationName: 'Escritório A',
				advisorType: AdvisorType.Assessor,
				invitedEmailMasked: expect.any(String),
				expiresAt: expect.any(String),
			});
			expect(JSON.stringify(res.body)).not.toContain('fulano@x.com');
		});

		it('answers 400 for the token in the query, with or without it in the body', async () => {
			const token = await inviteToken();
			const onlyQuery = await http()
				.post(`/advisor/v1/me/member-invites/preview?token=${token}`)
				.set(auth(INVITEE))
				.send({})
				.expect(400);
			expect(onlyQuery.body.reason).toBe('VALIDATION_FAILED');
			const both = await http()
				.post(`/advisor/v1/me/member-invites/preview?token=${token}`)
				.set(auth(INVITEE))
				.send({ token })
				.expect(400);
			expect(both.body).toEqual({
				statusCode: 400,
				error: 'BAD_REQUEST',
				reason: 'VALIDATION_FAILED',
			});
		});

		it('answers 400 for a missing, non-string or oversized token', async () => {
			for (const body of [{}, { token: 42 }, { token: 'a'.repeat(200) }]) {
				const res = await post('preview', body).expect(400);
				expect(res.body.reason).toBe('VALIDATION_FAILED');
			}
		});
	});

	describe('the same bare 404 for every token that does not serve', () => {
		it('invalid, of another e-mail or already used', async () => {
			const token = await inviteToken();
			for (const action of ['preview', 'accept', 'decline'] as const) {
				for (const res of [
					await post(action, { token: 'token-que-nao-existe' }),
					await post(action, { token }, OTHER),
				]) {
					expect(res.status).toBe(404);
					expect(res.body).toEqual(NOT_FOUND);
				}
			}

			await post('accept', { token }).expect(200);
			for (const action of ['preview', 'accept', 'decline'] as const) {
				const res = await post(action, { token }).expect(404);
				expect(res.body).toEqual(NOT_FOUND);
			}
		});

		it('an expired invite', async () => {
			const expired = generateInviteToken();
			await invites.create({
				orgId,
				email: 'fulano@x.com',
				role: OrgRole.Advisor,
				tokenHash: expired.tokenHash,
				status: MemberInviteStatus.Pending,
				expiresAt: new Date(Date.now() - 1000),
				resendCount: 0,
				invitedByUserId: OWNER,
			});
			const res = await post('preview', { token: expired.token }).expect(404);
			expect(res.body).toEqual(NOT_FOUND);
		});
	});

	describe('accept and decline', () => {
		it('accepts with 200 and creates the ADVISOR membership', async () => {
			const token = await inviteToken();
			const res = await post('accept', { token }).expect(200);
			expect(res.body).toEqual({ orgId, role: OrgRole.Advisor });
			expect((await memberships.findByUserAndOrg(INVITEE, orgId))?.role).toBe(
				OrgRole.Advisor
			);
		});

		it('answers 409 ALREADY_MEMBER when the account already is a member', async () => {
			const token = await inviteToken();
			await memberships.create({
				userId: INVITEE,
				orgId,
				role: OrgRole.Advisor,
			});
			const res = await post('accept', { token }).expect(409);
			expect(res.body).toEqual({
				statusCode: 409,
				error: 'CONFLICT',
				reason: 'ALREADY_MEMBER',
			});
		});

		it('declines with 204 and the token stops serving', async () => {
			const token = await inviteToken();
			const res = await post('decline', { token }).expect(204);
			expect(res.body).toEqual({});
			await post('preview', { token }).expect(404);
			expect(await memberships.findByUserAndOrg(INVITEE, orgId)).toBeNull();
		});
	});
});
