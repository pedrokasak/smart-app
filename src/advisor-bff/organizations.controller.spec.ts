import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ADVISOR_ORG_STORE } from 'src/advisor/application/advisor.tokens';
import {
	InMemoryInviteeIdentity,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
} from 'src/advisor/application/in-memory-stores.fixture';
import { MembershipService } from 'src/advisor/application/membership.service';
import { OrganizationService } from 'src/advisor/application/organization.service';
import { ADVISOR_INVITEE_IDENTITY } from 'src/advisor/application/ports/invitee-identity.port';
import { ADVISOR_MEMBERSHIP_STORE } from 'src/advisor/application/advisor.tokens';
import { PortalAccessService } from 'src/advisor/application/portal-access.service';
import { AdvisorType } from 'src/advisor/domain/enums';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import { jwtSecret } from 'src/env';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { AdvisorPortalGuard } from './advisor-portal.guard';
import { OrganizationsController } from './organizations.controller';

describe('OrganizationsController', () => {
	let app: INestApplication;
	let jwt: JwtService;
	let orgs: InMemoryOrganizationStore;
	let memberships: InMemoryMembershipStore;
	let identity: InMemoryInviteeIdentity;
	const hasAccess = jest.fn();

	const bearer = (userId: string) =>
		`Bearer ${jwt.sign({ userId, type: 'access', role: 'user' })}`;
	const http = () => request(app.getHttpServer());

	beforeEach(async () => {
		orgs = new InMemoryOrganizationStore();
		memberships = new InMemoryMembershipStore();
		identity = new InMemoryInviteeIdentity();
		const moduleRef = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: jwtSecret })],
			controllers: [OrganizationsController],
			providers: [
				AdvisorPortalGuard,
				OrganizationService,
				MembershipService,
				{ provide: ADVISOR_ORG_STORE, useValue: orgs },
				{ provide: ADVISOR_MEMBERSHIP_STORE, useValue: memberships },
				{ provide: ADVISOR_INVITEE_IDENTITY, useValue: identity },
				{ provide: AUDIT_TRAIL, useValue: { record: jest.fn() } },
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
	});

	afterEach(async () => {
		await app.close();
	});

	beforeEach(() => {
		hasAccess.mockReset().mockResolvedValue(true);
		identity.set('u1', { email: 'a@acme.com', emailVerified: true });
		identity.set('u2', { email: 'b@acme.com', emailVerified: true });
		identity.set('u3', { email: 'c@acme.com', emailVerified: false });
	});

	const body = { name: 'Acme Assessoria', advisorType: AdvisorType.Assessor };

	it('answers 401 without a JWT', async () => {
		await http().post('/advisor/v1/organizations').send(body).expect(401);
	});

	it('answers 403 PLAN_CAPABILITY_REQUIRED without portal access', async () => {
		hasAccess.mockResolvedValue(false);
		const res = await http()
			.post('/advisor/v1/organizations')
			.set('Authorization', bearer('u1'))
			.send(body)
			.expect(403);
		expect(res.body).toEqual({
			statusCode: 403,
			error: 'PLAN_CAPABILITY_REQUIRED',
		});
	});

	it('creates the organization (201) with the creator as ORG_ADMIN and no-store', async () => {
		const res = await http()
			.post('/advisor/v1/organizations')
			.set('Authorization', bearer('u1'))
			.send(body)
			.expect(201);
		expect(res.body).toEqual({
			id: expect.any(String),
			name: 'Acme Assessoria',
			advisorType: 'ASSESSOR',
			role: 'ORG_ADMIN',
		});
		expect(res.headers['cache-control']).toBe('no-store');
		expect(hasAccess).toHaveBeenCalledWith('u1');
	});

	it('rejects an invalid advisorType with 400', async () => {
		await http()
			.post('/advisor/v1/organizations')
			.set('Authorization', bearer('u1'))
			.send({ name: 'Acme', advisorType: 'GURU' })
			.expect(400);
	});

	it('rejects an invalid name with 400 INVALID_NAME', async () => {
		const res = await http()
			.post('/advisor/v1/organizations')
			.set('Authorization', bearer('u1'))
			.send({ name: ' a ', advisorType: 'ASSESSOR' })
			.expect(400);
		expect(res.body).toEqual({
			statusCode: 400,
			error: 'BAD_REQUEST',
			reason: 'INVALID_NAME',
		});
	});

	it('answers 403 EMAIL_NOT_VERIFIED for an unverified e-mail', async () => {
		const res = await http()
			.post('/advisor/v1/organizations')
			.set('Authorization', bearer('u3'))
			.send(body)
			.expect(403);
		expect(res.body.reason).toBe('EMAIL_NOT_VERIFIED');
	});

	it('answers 409 ALREADY_OWNS_ORGANIZATION on a second creation', async () => {
		await http()
			.post('/advisor/v1/organizations')
			.set('Authorization', bearer('u1'))
			.send(body)
			.expect(201);
		const res = await http()
			.post('/advisor/v1/organizations')
			.set('Authorization', bearer('u1'))
			.send(body)
			.expect(409);
		expect(res.body).toEqual({
			statusCode: 409,
			error: 'CONFLICT',
			reason: 'ALREADY_OWNS_ORGANIZATION',
		});
	});
});
