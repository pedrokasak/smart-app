import {
	BadRequestException,
	ConflictException,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { InMemoryModel } from 'src/payments/pix/testing/in-memory-model';
import { PixCheckoutService } from './pix-checkout.service';
import { PixGatewayError, PixGatewayPort } from './pix-gateway.port';

describe('PixCheckoutService (TRA-195)', () => {
	const now = new Date('2026-09-24T15:00:00Z');
	const VALID_CPF = '529.982.247-25';

	let gateway: jest.Mocked<PixGatewayPort>;
	let charges: InMemoryModel;
	let plans: InMemoryModel;
	let userSubscriptions: InMemoryModel;
	let users: InMemoryModel;
	let service: PixCheckoutService;
	let userId: string;
	let proPlanId: string;

	beforeEach(() => {
		gateway = {
			isEnabled: jest.fn().mockReturnValue(true),
			createCustomer: jest.fn().mockResolvedValue('cus_1'),
			createCharge: jest.fn().mockResolvedValue({ paymentId: 'pay_1' }),
			getQrCode: jest.fn().mockResolvedValue({
				payload: 'copia-e-cola',
				encodedImage: 'png-base64',
				expiresAt: new Date('2026-09-26T02:59:59Z'),
			}),
		};
		charges = new InMemoryModel();
		plans = new InMemoryModel();
		userSubscriptions = new InMemoryModel();
		users = new InMemoryModel();

		userId = String(
			users.seed({ email: 'ana@x.com', firstName: 'Ana', lastName: 'Lima' })._id
		);
		proPlanId = String(
			plans.seed({ name: 'Pro', price: 14.9, annualPrice: 149, isActive: true })
				._id
		);

		service = new PixCheckoutService(
			gateway,
			charges as any,
			plans as any,
			userSubscriptions as any,
			users as any
		);
	});

	it('emite a cobrança e devolve o QR', async () => {
		const view = await service.createCheckout(
			userId,
			{ planId: proPlanId, interval: 'month', cpf: VALID_CPF },
			now
		);

		expect(view).toMatchObject({
			status: 'pending',
			amount: 14.9,
			interval: 'month',
			qrCodePayload: 'copia-e-cola',
			qrCodeImage: 'png-base64',
			expiresAt: '2026-09-26T02:59:59.000Z',
		});
		expect(gateway.createCharge).toHaveBeenCalledWith(
			expect.objectContaining({
				customerId: 'cus_1',
				value: 14.9,
				dueDate: '2026-09-25',
				externalReference: view.chargeId,
			})
		);
		expect(charges.docs[0].asaasPaymentId).toBe('pay_1');
	});

	it('anual cobra o preço anual', async () => {
		const view = await service.createCheckout(
			userId,
			{ planId: proPlanId, interval: 'year', cpf: VALID_CPF },
			now
		);
		expect(view.amount).toBe(149);
	});

	describe('cliente no provedor e CPF', () => {
		it('cria o cliente uma vez, guarda o id e não grava CPF no usuário', async () => {
			await service.createCheckout(
				userId,
				{ planId: proPlanId, interval: 'month', cpf: VALID_CPF },
				now
			);

			const user = users.docs[0];
			expect(user.asaasCustomerId).toBe('cus_1');
			expect(user.cpf).toBeUndefined();
			expect(gateway.createCustomer).toHaveBeenCalledWith(
				expect.objectContaining({ cpf: '52998224725', name: 'Ana Lima' })
			);
		});

		it('segunda compra reaproveita o cliente e dispensa o CPF', async () => {
			users.docs[0].asaasCustomerId = 'cus_existente';

			await service.createCheckout(
				userId,
				{ planId: proPlanId, interval: 'year' },
				now
			);

			expect(gateway.createCustomer).not.toHaveBeenCalled();
			expect(gateway.createCharge).toHaveBeenCalledWith(
				expect.objectContaining({ customerId: 'cus_existente' })
			);
		});

		it.each([
			['ausente', undefined],
			['inválido', '529.982.247-26'],
		])(
			'primeira compra com CPF %s: 400 com código estável',
			async (_l, cpf) => {
				const error = await service
					.createCheckout(
						userId,
						{ planId: proPlanId, interval: 'month', cpf },
						now
					)
					.catch((e) => e);

				expect(error).toBeInstanceOf(BadRequestException);
				expect(error.getResponse()).toMatchObject({
					error: 'PIX_CPF_REQUIRED',
				});
				expect(gateway.createCustomer).not.toHaveBeenCalled();
			}
		);
	});

	it('reaproveita o QR pendente em vez de gerar cobrança nova (duplo clique)', async () => {
		const first = await service.createCheckout(
			userId,
			{ planId: proPlanId, interval: 'month', cpf: VALID_CPF },
			now
		);
		const second = await service.createCheckout(
			userId,
			{ planId: proPlanId, interval: 'month' },
			now
		);

		expect(second.chargeId).toBe(first.chargeId);
		expect(gateway.createCharge).toHaveBeenCalledTimes(1);
		expect(charges.docs).toHaveLength(1);
	});

	it('QR prestes a vencer não é reaproveitado', async () => {
		const first = await service.createCheckout(
			userId,
			{ planId: proPlanId, interval: 'month', cpf: VALID_CPF },
			now
		);
		charges.docs[0].expiresAt = new Date(now.getTime() + 60_000);
		gateway.createCharge.mockResolvedValueOnce({ paymentId: 'pay_2' });

		const second = await service.createCheckout(
			userId,
			{ planId: proPlanId, interval: 'month' },
			now
		);

		expect(second.chargeId).not.toBe(first.chargeId);
	});

	describe('recusas', () => {
		it('PIX desligado: 503 sem tocar no provedor', async () => {
			gateway.isEnabled.mockReturnValue(false);
			await expect(
				service.createCheckout(
					userId,
					{ planId: proPlanId, interval: 'month' },
					now
				)
			).rejects.toBeInstanceOf(ServiceUnavailableException);
			expect(gateway.createCharge).not.toHaveBeenCalled();
		});

		it('plano inexistente: 400', async () => {
			await expect(
				service.createCheckout(
					userId,
					{ planId: String(new Types.ObjectId()), interval: 'month' },
					now
				)
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it('plano gratuito: 400', async () => {
			const freeId = String(plans.seed({ name: 'Essencial', price: 0 })._id);
			await expect(
				service.createCheckout(
					userId,
					{ planId: freeId, interval: 'month' },
					now
				)
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it('anual em plano sem preço anual: 400', async () => {
			const monthlyOnly = String(plans.seed({ name: 'X', price: 10 })._id);
			await expect(
				service.createCheckout(
					userId,
					{ planId: monthlyOnly, interval: 'year', cpf: VALID_CPF },
					now
				)
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it('assinatura de cartão ativa: 409, para não cobrar em dobro', async () => {
			userSubscriptions.seed({
				user: new Types.ObjectId(userId),
				status: 'active',
				stripeSubscriptionId: 'sub_123',
				currentPeriodEnd: new Date('2099-01-01'),
			});

			await expect(
				service.createCheckout(
					userId,
					{ planId: proPlanId, interval: 'month', cpf: VALID_CPF },
					now
				)
			).rejects.toBeInstanceOf(ConflictException);
			expect(gateway.createCharge).not.toHaveBeenCalled();
		});
	});

	describe('falha no provedor', () => {
		it('cobrança recusada fica como failed e o erro chega como 400 legível', async () => {
			gateway.createCharge.mockRejectedValue(
				new PixGatewayError('O provedor de PIX recusou a operação.', 400)
			);

			await expect(
				service.createCheckout(
					userId,
					{ planId: proPlanId, interval: 'month', cpf: VALID_CPF },
					now
				)
			).rejects.toBeInstanceOf(BadRequestException);
			expect(charges.docs[0].status).toBe('failed');
		});

		it('QR indisponível depois da cobrança criada: mantém pending com o id do provedor', async () => {
			gateway.getQrCode.mockRejectedValue(
				new PixGatewayError('QR indisponível')
			);

			await expect(
				service.createCheckout(
					userId,
					{ planId: proPlanId, interval: 'month', cpf: VALID_CPF },
					now
				)
			).rejects.toBeInstanceOf(BadRequestException);
			// Se o usuário pagar por outro caminho, o webhook ainda concilia.
			expect(charges.docs[0]).toMatchObject({
				status: 'pending',
				asaasPaymentId: 'pay_1',
			});
		});
	});

	describe('consulta da cobrança', () => {
		it('dono vê o estado', async () => {
			const { chargeId } = await service.createCheckout(
				userId,
				{ planId: proPlanId, interval: 'month', cpf: VALID_CPF },
				now
			);
			await expect(service.getCharge(userId, chargeId)).resolves.toMatchObject({
				chargeId,
				status: 'pending',
			});
		});

		it('outro usuário recebe 404, não a cobrança alheia', async () => {
			const { chargeId } = await service.createCheckout(
				userId,
				{ planId: proPlanId, interval: 'month', cpf: VALID_CPF },
				now
			);
			await expect(
				service.getCharge(String(new Types.ObjectId()), chargeId)
			).rejects.toBeInstanceOf(NotFoundException);
		});

		it('cobrança paga não devolve mais o QR', async () => {
			const { chargeId } = await service.createCheckout(
				userId,
				{ planId: proPlanId, interval: 'month', cpf: VALID_CPF },
				now
			);
			charges.docs[0].status = 'paid';

			const view = await service.getCharge(userId, chargeId);
			expect(view.qrCodePayload).toBeUndefined();
			expect(view.qrCodeImage).toBeUndefined();
		});
	});
});
