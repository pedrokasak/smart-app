import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminController } from 'src/admin/admin.controller';
import { AdminService } from 'src/admin/admin.service';
import { daysAgo } from 'src/admin/application/user-activity-metrics';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { jwtSecret } from 'src/env';
import { EmailService } from 'src/notifications/email/email.service';
import { StripeService } from 'src/subscription/stripe.service';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';

/**
 * Integração do contador de usuários do painel admin (TRA-192).
 *
 * Monta o app Nest com o `JwtAuthGuard` registrado como `APP_GUARD` — do
 * mesmo jeito que `app.module.ts` faz em produção — e passa por HTTP de
 * verdade. Lição do incidente do 2FA: spec que monta só o controller testa um
 * mundo sem os guards globais, e o que quebra em produção passa verde.
 */
describe('GET /admin/overview — contagem de usuários (integração)', () => {
	let app: INestApplication;
	let jwt: JwtService;

	const now = new Date();
	const userDocs = [
		{ createdAt: now, lastSeenAt: now },
		{ createdAt: daysAgo(now, 15), lastSeenAt: daysAgo(now, 5) },
		{ createdAt: daysAgo(now, 90) },
	];

	/** Avalia `$gte` de data de verdade, como o Mongo faria. */
	const userModel = {
		findOne: jest.fn().mockResolvedValue(null),
		countDocuments: jest.fn((filter: Record<string, { $gte: Date }> = {}) => ({
			exec: async () =>
				userDocs.filter((doc) =>
					Object.entries(filter).every(([field, condition]) => {
						const value = doc[field as keyof typeof doc];
						return value instanceof Date && value >= condition.$gte;
					})
				).length,
		})),
	};

	const accessToken = (role: string) =>
		jwt.sign({ userId: 'u-1', type: 'access', role });

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: jwtSecret })],
			controllers: [AdminController],
			providers: [
				AdminService,
				{ provide: APP_GUARD, useClass: JwtAuthGuard },
				{
					provide: TokenBlacklistService,
					useValue: { isBlacklisted: jest.fn().mockResolvedValue(false) },
				},
				{ provide: getModelToken('User'), useValue: userModel },
				{ provide: getModelToken('Subscription'), useValue: {} },
				{
					provide: getModelToken('UserSubscription'),
					useValue: {
						countDocuments: jest.fn().mockResolvedValue(0),
						aggregate: jest.fn().mockResolvedValue([]),
					},
				},
				{
					provide: getModelToken('ManualGrantAudit'),
					useValue: { countDocuments: jest.fn().mockResolvedValue(0) },
				},
				{ provide: StripeService, useValue: {} },
				{ provide: EmailService, useValue: {} },
			],
		}).compile();

		app = moduleRef.createNestApplication();
		await app.init();
		jwt = moduleRef.get(JwtService);
	});

	afterAll(async () => {
		await app.close();
	});

	it('admin recebe as contagens agregadas', async () => {
		const response = await request(app.getHttpServer())
			.get('/admin/overview')
			.set('Authorization', `Bearer ${accessToken('admin')}`)
			.expect(200);

		expect(response.body.users).toEqual({
			total: 3,
			newLast7Days: 1,
			newLast30Days: 2,
			activeLast24h: 1,
			activeLast7Days: 2,
			activeLast30Days: 2,
		});
	});

	it('a resposta não carrega nenhum dado pessoal', async () => {
		const response = await request(app.getHttpServer())
			.get('/admin/overview')
			.set('Authorization', `Bearer ${accessToken('admin')}`)
			.expect(200);

		const serialized = JSON.stringify(response.body).toLowerCase();
		for (const forbidden of [
			'email',
			'firstname',
			'lastname',
			'cpf',
			'phone',
			'userid',
		]) {
			expect(serialized).not.toContain(forbidden);
		}
		// O model falso não tem `find`: se o contador tentasse ler
		// documentos em vez de contar, a rota responderia 500, não 200.
	});

	it('usuário comum é barrado (403)', async () => {
		await request(app.getHttpServer())
			.get('/admin/overview')
			.set('Authorization', `Bearer ${accessToken('user')}`)
			.expect(403);
	});

	it('editor é barrado (403) — overview é só de admin', async () => {
		await request(app.getHttpServer())
			.get('/admin/overview')
			.set('Authorization', `Bearer ${accessToken('editor')}`)
			.expect(403);
	});

	it('sem token é barrado (401) pelo guard global', async () => {
		await request(app.getHttpServer()).get('/admin/overview').expect(401);
	});

	it('refresh token não serve como credencial (401)', async () => {
		const refresh = jwt.sign({ userId: 'u-1', type: 'refresh', role: 'admin' });

		await request(app.getHttpServer())
			.get('/admin/overview')
			.set('Authorization', `Bearer ${refresh}`)
			.expect(401);
	});
});
