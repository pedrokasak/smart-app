import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
	InMemoryPortalAccountDirectory,
	InMemoryPortalGrantStore,
} from 'src/advisor/application/in-memory-stores.fixture';
import { PortalAccessService } from 'src/advisor/application/portal-access.service';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { jwtSecret } from 'src/env';
import { FREE_ACCESS_LEVEL } from 'src/subscription/application/user-plan.types';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { AdminAdvisorPortalController } from './admin-advisor-portal.controller';

/**
 * HTTP de verdade com o `JwtAuthGuard` global, como em produção, e o
 * `PortalAccessService` real sobre stores em memória.
 */
describe('/admin/advisor-portal-access', () => {
	const USER = '64b000000000000000000001';
	const ADMIN = '64b0000000000000000000ad';

	let app: INestApplication;
	let jwt: JwtService;
	let grants: InMemoryPortalGrantStore;
	let portal: PortalAccessService;

	const tokenFor = (role: string) =>
		jwt.sign({ userId: ADMIN, type: 'access', role });
	const asAdmin = () => `Bearer ${tokenFor('admin')}`;

	beforeEach(async () => {
		grants = new InMemoryPortalGrantStore();
		const accounts = new InMemoryPortalAccountDirectory();
		accounts.set(USER, 'investidor@example.com');
		portal = new PortalAccessService(
			grants,
			accounts,
			{
				resolve: async () => FREE_ACCESS_LEVEL,
				resolveWithCapabilities: async () => ({
					tier: FREE_ACCESS_LEVEL,
					capabilities: [],
				}),
			},
			{ emit: () => undefined }
		);

		const moduleRef = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: jwtSecret })],
			controllers: [AdminAdvisorPortalController],
			providers: [
				{ provide: PortalAccessService, useValue: portal },
				{ provide: APP_GUARD, useClass: JwtAuthGuard },
				{
					provide: TokenBlacklistService,
					useValue: { isBlacklisted: jest.fn().mockResolvedValue(false) },
				},
			],
		}).compile();

		app = moduleRef.createNestApplication();
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

	it.each(['user', 'editor'])('a %s gets 403 on every route', async (role) => {
		const auth = `Bearer ${tokenFor(role)}`;
		const server = app.getHttpServer();
		await request(server)
			.post('/admin/advisor-portal-access')
			.set('Authorization', auth)
			.send({ email: 'investidor@example.com' })
			.expect(403);
		await request(server)
			.get('/admin/advisor-portal-access')
			.set('Authorization', auth)
			.expect(403);
		await request(server)
			.delete(`/admin/advisor-portal-access/${USER}`)
			.set('Authorization', auth)
			.expect(403);
		expect(await grants.listActive()).toEqual([]);
	});

	it('granting twice keeps one active grant', async () => {
		for (let i = 0; i < 2; i += 1) {
			const res = await request(app.getHttpServer())
				.post('/admin/advisor-portal-access')
				.set('Authorization', asAdmin())
				.send({ email: 'investidor@example.com' })
				.expect(201);
			expect(res.body).toEqual({ userId: USER });
		}
		expect(await grants.listActive()).toHaveLength(1);
		await expect(portal.hasAccess(USER)).resolves.toBe(true);
	});

	it('an e-mail without an account is 404; a malformed one is 400', async () => {
		await request(app.getHttpServer())
			.post('/admin/advisor-portal-access')
			.set('Authorization', asAdmin())
			.send({ email: 'ninguem@example.com' })
			.expect(404);
		await request(app.getHttpServer())
			.post('/admin/advisor-portal-access')
			.set('Authorization', asAdmin())
			.send({ email: 'not-an-email' })
			.expect(400);
	});

	it('revoke answers 204 and cuts access on the next check', async () => {
		await portal.grantByEmail(ADMIN, 'investidor@example.com');

		await request(app.getHttpServer())
			.delete(`/admin/advisor-portal-access/${USER}`)
			.set('Authorization', asAdmin())
			.expect(204);

		await expect(portal.hasAccess(USER)).resolves.toBe(false);
		await request(app.getHttpServer())
			.delete(`/admin/advisor-portal-access/${USER}`)
			.set('Authorization', asAdmin())
			.expect(404);
		await request(app.getHttpServer())
			.delete('/admin/advisor-portal-access/not-an-id')
			.set('Authorization', asAdmin())
			.expect(400);
	});

	it('the listing carries no e-mail in clear', async () => {
		await portal.grantByEmail(ADMIN, 'investidor@example.com');

		const res = await request(app.getHttpServer())
			.get('/admin/advisor-portal-access')
			.set('Authorization', asAdmin())
			.expect(200);

		expect(res.body).toEqual([
			{
				userId: USER,
				emailMasked: 'in***@ex***.com',
				grantedAt: expect.any(String),
			},
		]);
		expect(JSON.stringify(res.body)).not.toContain('investidor@');
	});
});
