import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { jwtSecret } from 'src/env';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { PixCheckoutService } from './application/pix-checkout.service';
import { PIX_GATEWAY, PixGatewayPort } from './application/pix-gateway.port';
import { PixPaymentConfirmationService } from './application/pix-payment-confirmation.service';
import {
	ASAAS_WEBHOOK_TOKEN,
	AsaasWebhookController,
} from './asaas-webhook.controller';
import { PixController } from './pix.controller';
import { InMemoryModel } from './testing/in-memory-model';

/**
 * Fluxo PIX completo por HTTP (TRA-195), com o `JwtAuthGuard` global e o
 * `ValidationPipe` configurados como em produção:
 *
 *   checkout (autenticado) -> QR -> webhook do Asaas (público, com token)
 *   -> plano liberado -> polling mostra "paid".
 *
 * Lição do incidente do 2FA: rota `@Public()` só prova que funciona com o
 * guard global montado. Sem isso, um webhook barrado com 401 em produção
 * passaria verde aqui.
 */
describe('PIX — integração HTTP', () => {
	const WEBHOOK_TOKEN = 'token-do-painel-asaas';
	const VALID_CPF = '529.982.247-25';

	let app: INestApplication;
	let jwt: JwtService;
	let charges: InMemoryModel;
	let plans: InMemoryModel;
	let userSubscriptions: InMemoryModel;
	let users: InMemoryModel;
	let userId: string;
	let planId: string;
	let gateway: jest.Mocked<PixGatewayPort>;

	const auth = () =>
		`Bearer ${jwt.sign({ userId, type: 'access', role: 'user' })}`;

	async function buildApp(webhookToken: string) {
		const moduleRef = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: jwtSecret })],
			controllers: [PixController, AsaasWebhookController],
			providers: [
				{ provide: APP_GUARD, useClass: JwtAuthGuard },
				{
					provide: TokenBlacklistService,
					useValue: { isBlacklisted: jest.fn().mockResolvedValue(false) },
				},
				{ provide: PIX_GATEWAY, useValue: gateway },
				{ provide: ASAAS_WEBHOOK_TOKEN, useValue: webhookToken },
				{ provide: getModelToken('PixCharge'), useValue: charges },
				{ provide: getModelToken('Subscription'), useValue: plans },
				{
					provide: getModelToken('UserSubscription'),
					useValue: userSubscriptions,
				},
				{ provide: getModelToken('User'), useValue: users },
				PixCheckoutService,
				PixPaymentConfirmationService,
			],
		}).compile();

		const nestApp = moduleRef.createNestApplication();
		nestApp.useGlobalPipes(
			new ValidationPipe({
				whitelist: true,
				forbidNonWhitelisted: true,
				transform: true,
			})
		);
		await nestApp.init();
		jwt = moduleRef.get(JwtService);
		return nestApp;
	}

	beforeEach(async () => {
		charges = new InMemoryModel();
		plans = new InMemoryModel();
		userSubscriptions = new InMemoryModel();
		users = new InMemoryModel();
		userId = String(users.seed({ email: 'ana@x.com', firstName: 'Ana' })._id);
		planId = String(
			plans.seed({ name: 'Pro', price: 14.9, annualPrice: 149, isActive: true })
				._id
		);
		gateway = {
			isEnabled: jest.fn().mockReturnValue(true),
			createCustomer: jest.fn().mockResolvedValue('cus_1'),
			createCharge: jest.fn().mockResolvedValue({ paymentId: 'pay_1' }),
			getQrCode: jest.fn().mockResolvedValue({
				payload: 'copia-e-cola',
				encodedImage: 'png',
				expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
			}),
		};
		app = await buildApp(WEBHOOK_TOKEN);
	});

	afterEach(async () => {
		await app.close();
	});

	const checkout = (body: object) =>
		request(app.getHttpServer())
			.post('/payments/pix/checkout')
			.set('Authorization', auth())
			.send(body);

	const webhook = (body: object, token: string | null = WEBHOOK_TOKEN) => {
		const req = request(app.getHttpServer()).post('/webhooks/asaas').send(body);
		return token === null ? req : req.set('asaas-access-token', token);
	};

	it('fluxo completo: checkout -> webhook -> plano liberado -> polling "paid"', async () => {
		const created = await checkout({
			planId,
			interval: 'month',
			cpf: VALID_CPF,
		}).expect(201);
		expect(created.body).toMatchObject({
			status: 'pending',
			amount: 14.9,
			qrCodePayload: 'copia-e-cola',
		});

		// Webhook sem JWT nenhum: só o token do Asaas.
		const delivered = await webhook({
			event: 'PAYMENT_RECEIVED',
			payment: { id: 'pay_1', value: 14.9 },
		}).expect(200);
		expect(delivered.body).toEqual({ received: true, outcome: 'activated' });

		expect(userSubscriptions.docs[0]).toMatchObject({
			status: 'active',
			paymentProvider: 'asaas_pix',
		});

		const polled = await request(app.getHttpServer())
			.get(`/payments/pix/charges/${created.body.chargeId}`)
			.set('Authorization', auth())
			.expect(200);
		expect(polled.body.status).toBe('paid');
		expect(polled.body.periodEnd).toBeDefined();
	});

	it('reentrega do mesmo webhook responde 200 e não libera de novo', async () => {
		await checkout({ planId, interval: 'month', cpf: VALID_CPF }).expect(201);
		const payload = {
			event: 'PAYMENT_CONFIRMED',
			payment: { id: 'pay_1', value: 14.9 },
		};

		await webhook(payload).expect(200);
		const end = userSubscriptions.docs[0].currentPeriodEnd;
		const again = await webhook(payload).expect(200);

		expect(again.body.outcome).toBe('duplicate');
		expect(userSubscriptions.docs[0].currentPeriodEnd).toEqual(end);
	});

	describe('autenticação do webhook', () => {
		const body = {
			event: 'PAYMENT_RECEIVED',
			payment: { id: 'pay_1', value: 14.9 },
		};

		it('sem token: 401 e nada muda', async () => {
			await checkout({ planId, interval: 'month', cpf: VALID_CPF });
			await webhook(body, null).expect(401);
			expect(userSubscriptions.docs).toHaveLength(0);
		});

		it('token errado: 401', async () => {
			await webhook(body, 'token-errado').expect(401);
		});

		it('token com prefixo certo mas tamanho diferente: 401', async () => {
			await webhook(body, `${WEBHOOK_TOKEN}x`).expect(401);
		});

		it('servidor sem ASAAS_WEBHOOK_TOKEN recusa tudo (503), mesmo com header vazio', async () => {
			await app.close();
			app = await buildApp('');
			await webhook(body, '').expect(503);
		});

		it('JWT de usuário não substitui o token do Asaas', async () => {
			await request(app.getHttpServer())
				.post('/webhooks/asaas')
				.set('Authorization', auth())
				.send(body)
				.expect(401);
		});

		it('corpo sem evento: 400', async () => {
			await webhook({ payment: { id: 'pay_1' } }).expect(400);
		});
	});

	it('availability informa se o PIX está ligado (autenticado)', async () => {
		const response = await request(app.getHttpServer())
			.get('/payments/pix/availability')
			.set('Authorization', auth())
			.expect(200);
		expect(response.body).toEqual({ enabled: true });
	});

	describe('checkout', () => {
		it('sem login: 401 do guard global', async () => {
			await request(app.getHttpServer())
				.post('/payments/pix/checkout')
				.send({ planId, interval: 'month' })
				.expect(401);
			expect(gateway.createCharge).not.toHaveBeenCalled();
		});

		it.each([
			['intervalo inválido', { interval: 'week' }],
			['planId não é ObjectId', { planId: 'pro' }],
			['campo extra', { extra: 1 }],
		])('%s: 400 do ValidationPipe', async (_label, override) => {
			await checkout({ planId, interval: 'month', ...override }).expect(400);
			expect(gateway.createCharge).not.toHaveBeenCalled();
		});

		it('CPF faltando na primeira compra: 400 com código para o web pedir o CPF', async () => {
			const response = await checkout({ planId, interval: 'month' }).expect(
				400
			);
			expect(response.body.error).toBe('PIX_CPF_REQUIRED');
		});

		it('cobrança de outro usuário: 404', async () => {
			const created = await checkout({
				planId,
				interval: 'month',
				cpf: VALID_CPF,
			});
			const other = jwt.sign({
				userId: String(new Types.ObjectId()),
				type: 'access',
				role: 'user',
			});
			await request(app.getHttpServer())
				.get(`/payments/pix/charges/${created.body.chargeId}`)
				.set('Authorization', `Bearer ${other}`)
				.expect(404);
		});
	});
});
