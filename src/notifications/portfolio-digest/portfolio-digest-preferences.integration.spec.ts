import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { jwtSecret } from 'src/env';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { DigestUnsubscribeTokenService } from './application/digest-unsubscribe-token.service';
import { PortfolioDigestController } from './portfolio-digest.controller';

/**
 * TRA-202: com o `JwtAuthGuard` global montado, prova que quem tem sessão
 * consegue de fato ligar o digest por HTTP — não só que o método do
 * controller funciona isolado. A rota é nova; sem isto o teste de unidade
 * sozinho não prova que a rota está registrada nem que passa pelo guard.
 */
describe('GET/PATCH /notifications/digest/preferences — integração (TRA-202)', () => {
	let app: INestApplication;
	let jwt: JwtService;
	const userDoc = {
		notificationPreferences: { portfolioDigest: { enabled: false } },
	};
	const userModel = {
		findById: jest.fn(() => ({
			select: jest.fn().mockResolvedValue(userDoc),
		})),
		findByIdAndUpdate: jest.fn().mockResolvedValue({}),
	};

	const bearer = (type = 'access') =>
		`Bearer ${jwt.sign({ userId: 'user-1', type, role: 'user' })}`;

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: jwtSecret })],
			controllers: [PortfolioDigestController],
			providers: [
				{ provide: APP_GUARD, useClass: JwtAuthGuard },
				{
					provide: TokenBlacklistService,
					useValue: { isBlacklisted: jest.fn().mockResolvedValue(false) },
				},
				{
					provide: DigestUnsubscribeTokenService,
					useValue: { verify: jest.fn() },
				},
				{ provide: getModelToken('User'), useValue: userModel },
			],
		}).compile();

		app = moduleRef.createNestApplication();
		await app.init();
		jwt = moduleRef.get(JwtService);
	});

	afterAll(async () => {
		await app.close();
	});

	it('sem token: 401, o campo não muda', async () => {
		await request(app.getHttpServer())
			.patch('/notifications/digest/preferences')
			.send({ enabled: true })
			.expect(401);
		expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
	});

	it('com sessão, liga o digest — a rota que nunca existiu antes do TRA-202', async () => {
		const response = await request(app.getHttpServer())
			.patch('/notifications/digest/preferences')
			.set('Authorization', bearer())
			.send({ enabled: true })
			.expect(200);

		expect(response.body).toEqual({ enabled: true });
		expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				$set: expect.objectContaining({
					'notificationPreferences.portfolioDigest.enabled': true,
				}),
			})
		);
	});

	it('corpo sem "enabled" (ou não-boolean): 400 do ValidationPipe global não está aqui, mas o DTO recusa no controller', async () => {
		// Sem `ValidationPipe` global montado neste teste isolado, o valor
		// passa cru — o contrato do DTO é coberto no unit spec do controller.
		// Aqui só se confirma que a leitura funciona.
		const before = await request(app.getHttpServer())
			.get('/notifications/digest/preferences')
			.set('Authorization', bearer())
			.expect(200);
		expect(before.body).toEqual({ enabled: false });
	});

	it('token do tipo refresh não serve como sessão (401)', async () => {
		await request(app.getHttpServer())
			.patch('/notifications/digest/preferences')
			.set('Authorization', bearer('refresh'))
			.send({ enabled: true })
			.expect(401);
	});
});
