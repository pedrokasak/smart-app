import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_ORG_STORE,
} from 'src/advisor/application/advisor.tokens';
import {
	InMemoryInviteeIdentity,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
} from 'src/advisor/application/in-memory-stores.fixture';
import { MembershipService } from 'src/advisor/application/membership.service';
import { OrganizationService } from 'src/advisor/application/organization.service';
import { PortalAccessService } from 'src/advisor/application/portal-access.service';
import { ADVISOR_INVITEE_IDENTITY } from 'src/advisor/application/ports/invitee-identity.port';
import { AdvisorType, OrgRole } from 'src/advisor/domain/enums';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import { jwtSecret } from 'src/env';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { MeOrganizationsController } from './me-organizations.controller';

describe('MeOrganizationsController', () => {
	let app: INestApplication;
	let jwt: JwtService;
	let orgs: InMemoryOrganizationStore;
	let memberships: InMemoryMembershipStore;
	const hasAccess = jest.fn();

	const bearer = (userId: string) =>
		`Bearer ${jwt.sign({ userId, type: 'access', role: 'user' })}`;
	const http = () => request(app.getHttpServer());
	const list = (userId: string) =>
		http()
			.get('/advisor/v1/me/organizations')
			.set('Authorization', bearer(userId));

	const newOrg = async (name: string, ownerUserId?: string) =>
		(
			await orgs.create({
				name,
				advisorType: AdvisorType.Assessor,
				ownerUserId,
			})
		).id;

	beforeEach(async () => {
		orgs = new InMemoryOrganizationStore();
		memberships = new InMemoryMembershipStore();
		const moduleRef = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: jwtSecret })],
			controllers: [MeOrganizationsController],
			providers: [
				OrganizationService,
				MembershipService,
				{ provide: ADVISOR_ORG_STORE, useValue: orgs },
				{ provide: ADVISOR_MEMBERSHIP_STORE, useValue: memberships },
				{
					provide: ADVISOR_INVITEE_IDENTITY,
					useValue: new InMemoryInviteeIdentity(),
				},
				{ provide: AUDIT_TRAIL, useValue: { record: jest.fn() } },
				{ provide: PortalAccessService, useValue: { hasAccess } },
				{
					provide: TokenBlacklistService,
					useValue: { isBlacklisted: jest.fn().mockResolvedValue(false) },
				},
			],
		}).compile();
		app = moduleRef.createNestApplication();
		await app.init();
		jwt = moduleRef.get(JwtService);
		hasAccess.mockReset().mockResolvedValue(true);
	});

	afterEach(async () => {
		await app.close();
	});

	it('answers 401 without a JWT', async () => {
		await http().get('/advisor/v1/me/organizations').expect(401);
	});

	it('lets a member without plan or grant list the organization with portalActive true, false after the owner loses access', async () => {
		const orgId = await newOrg('Acme', 'owner1');
		await memberships.create({ userId: 'm1', orgId, role: OrgRole.Advisor });
		// So o dono tem acesso; o membro nao tem plano nem liberacao.
		hasAccess.mockImplementation(async (userId: string) => userId === 'owner1');

		const res = await list('m1').expect(200);
		expect(res.body).toEqual([
			{
				id: orgId,
				name: 'Acme',
				advisorType: 'ASSESSOR',
				role: OrgRole.Advisor,
				portalActive: true,
			},
		]);
		expect(res.headers['cache-control']).toBe('no-store');
		expect(hasAccess).not.toHaveBeenCalledWith('m1');

		hasAccess.mockResolvedValue(false);
		const revoked = await list('m1').expect(200);
		expect(revoked.body[0].portalActive).toBe(false);
	});

	it('is portalActive false for an organization without owner', async () => {
		const orgId = await newOrg('Legada');
		await memberships.create({ userId: 'm1', orgId, role: OrgRole.OrgAdmin });
		const res = await list('m1').expect(200);
		expect(res.body[0].portalActive).toBe(false);
		expect(hasAccess).not.toHaveBeenCalled();
	});

	it('computes portalActive per organization from its own owner', async () => {
		const first = await newOrg('Um', 'owner1');
		const second = await newOrg('Dois', 'owner2');
		const third = await newOrg('Tres', 'owner1' + 'x');
		for (const orgId of [first, second, third]) {
			await memberships.create({ userId: 'm1', orgId, role: OrgRole.Advisor });
		}
		hasAccess.mockImplementation(async (userId: string) => userId === 'owner2');

		const res = await list('m1').expect(200);
		expect(res.body.map((o: any) => o.portalActive)).toEqual([
			false,
			true,
			false,
		]);
		expect(hasAccess).toHaveBeenCalledTimes(3);
	});

	it('does not ask the same owner twice', async () => {
		const a = await newOrg('A', 'owner1');
		await memberships.create({ userId: 'm1', orgId: a, role: OrgRole.Advisor });
		const res = await list('m1').expect(200);
		expect(res.body).toHaveLength(1);
		expect(hasAccess).toHaveBeenCalledTimes(1);
	});

	it('lists nothing for a user without memberships', async () => {
		const res = await list('nobody').expect(200);
		expect(res.body).toEqual([]);
	});
});
