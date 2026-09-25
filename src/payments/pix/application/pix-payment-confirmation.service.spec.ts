import { Types } from 'mongoose';
import { InMemoryModel } from 'src/payments/pix/testing/in-memory-model';
import { PixPaymentConfirmationService } from './pix-payment-confirmation.service';

describe('PixPaymentConfirmationService (TRA-195)', () => {
	const now = new Date('2026-09-24T15:00:00Z');
	const userId = new Types.ObjectId();
	const planId = new Types.ObjectId();

	let charges: InMemoryModel;
	let userSubscriptions: InMemoryModel;
	let service: PixPaymentConfirmationService;

	const paid = (value = 14.9, id = 'pay_1') => ({
		event: 'PAYMENT_RECEIVED',
		payment: { id, value },
	});

	beforeEach(() => {
		charges = new InMemoryModel();
		userSubscriptions = new InMemoryModel();
		charges.seed({
			user: userId,
			plan: planId,
			interval: 'month',
			amount: 14.9,
			status: 'pending',
			asaasPaymentId: 'pay_1',
		});
		service = new PixPaymentConfirmationService(
			charges as any,
			userSubscriptions as any
		);
	});

	const subscription = () => userSubscriptions.docs[0];

	it('pagamento confirmado libera o plano por um mês', async () => {
		await expect(service.handle(paid(), now)).resolves.toBe('activated');

		expect(subscription()).toMatchObject({
			status: 'active',
			paymentProvider: 'asaas_pix',
			currentPeriodStart: now,
			currentPeriodEnd: new Date('2026-10-24T15:00:00Z'),
			lastPixChargeId: String(charges.docs[0]._id),
		});
		expect(String(subscription().user)).toBe(String(userId));
		expect(String(subscription().plan)).toBe(String(planId));
		expect(charges.docs[0]).toMatchObject({
			status: 'paid',
			paidAt: now,
			periodEnd: new Date('2026-10-24T15:00:00Z'),
		});
	});

	it('entrega repetida do webhook NÃO estende o período de novo', async () => {
		await service.handle(paid(), now);
		const endAfterFirst = subscription().currentPeriodEnd;

		await expect(service.handle(paid(), now)).resolves.toBe('duplicate');
		await expect(
			service.handle(
				{ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1', value: 14.9 } },
				now
			)
		).resolves.toBe('duplicate');

		expect(subscription().currentPeriodEnd).toEqual(endAfterFirst);
		expect(userSubscriptions.docs).toHaveLength(1);
	});

	it('renovação antecipada do mesmo plano emenda no fim do período atual', async () => {
		const currentEnd = new Date('2026-10-01T00:00:00Z');
		userSubscriptions.seed({
			user: userId,
			plan: planId,
			status: 'active',
			paymentProvider: 'asaas_pix',
			currentPeriodEnd: currentEnd,
		});

		await service.handle(paid(), now);

		expect(subscription().currentPeriodStart).toEqual(currentEnd);
		expect(subscription().currentPeriodEnd).toEqual(
			new Date('2026-11-01T00:00:00Z')
		);
	});

	it('pagamento substitui um trial concedido e limpa as datas de trial', async () => {
		userSubscriptions.seed({
			user: userId,
			plan: new Types.ObjectId(),
			status: 'trialing',
			trialStart: new Date('2026-09-20'),
			trialEnd: new Date('2026-09-27'),
			currentPeriodEnd: new Date('2026-09-27'),
		});

		await service.handle(paid(), now);

		expect(userSubscriptions.docs).toHaveLength(1);
		expect(subscription().status).toBe('active');
		expect(subscription().trialEnd).toBeUndefined();
		// Plano diferente: não emenda no trial, começa agora.
		expect(subscription().currentPeriodStart).toEqual(now);
	});

	it('PIX pago depois do OVERDUE ainda libera — o dinheiro entrou', async () => {
		await service.handle(
			{ event: 'PAYMENT_OVERDUE', payment: { id: 'pay_1' } },
			now
		);
		expect(charges.docs[0].status).toBe('expired');

		await expect(service.handle(paid(), now)).resolves.toBe('activated');
	});

	it('falha ao gravar a assinatura reabre a cobrança: a reentrega libera o plano', async () => {
		const original = userSubscriptions.findOneAndUpdate.bind(userSubscriptions);
		const spy = jest
			.spyOn(userSubscriptions, 'findOneAndUpdate')
			.mockRejectedValueOnce(new Error('mongo caiu'));

		// 1ª entrega: erro sobe (o controller responde 500 e o Asaas reenvia).
		await expect(service.handle(paid(), now)).rejects.toThrow('mongo caiu');
		expect(charges.docs[0].status).toBe('pending');
		expect(charges.docs[0].paidAt).toBeUndefined();

		// 2ª entrega: libera de verdade — não vira `duplicate`.
		spy.mockImplementation(original);
		await expect(service.handle(paid(), now)).resolves.toBe('activated');
		expect(subscription().status).toBe('active');
	});

	describe('não libera sozinho', () => {
		it('valor abaixo do cobrado vai para revisão', async () => {
			await expect(service.handle(paid(1.0), now)).resolves.toBe(
				'needs_review'
			);

			expect(userSubscriptions.docs).toHaveLength(0);
			expect(charges.docs[0].status).toBe('needs_review');
			expect(charges.docs[0].reviewReason).toMatch(/menor que o cobrado/);
		});

		it('assinatura de cartão ativa não é sobrescrita', async () => {
			userSubscriptions.seed({
				user: userId,
				plan: planId,
				status: 'active',
				stripeSubscriptionId: 'sub_1',
				currentPeriodEnd: new Date('2026-12-01'),
			});

			await expect(service.handle(paid(), now)).resolves.toBe('needs_review');
			expect(subscription().stripeSubscriptionId).toBe('sub_1');
			expect(subscription().paymentProvider).toBeUndefined();
		});

		it('pagamento desconhecido é ignorado (200 para o provedor parar de reenviar)', async () => {
			await expect(
				service.handle(paid(14.9, 'pay_de_outro_sistema'), now)
			).resolves.toBe('unknown_payment');
			expect(userSubscriptions.docs).toHaveLength(0);
		});
	});

	describe('estorno', () => {
		it('estorno da cobrança que liberou o plano derruba o plano agora', async () => {
			await service.handle(paid(), now);

			await expect(
				service.handle(
					{ event: 'PAYMENT_REFUNDED', payment: { id: 'pay_1' } },
					now
				)
			).resolves.toBe('refunded');

			expect(subscription()).toMatchObject({
				status: 'canceled',
				endedAt: now,
			});
			expect(charges.docs[0].status).toBe('refunded');
		});

		it('estorno de uma renovação antecipada só desfaz a extensão', async () => {
			const currentEnd = new Date('2026-10-01T00:00:00Z');
			userSubscriptions.seed({
				user: userId,
				plan: planId,
				status: 'active',
				paymentProvider: 'asaas_pix',
				currentPeriodEnd: currentEnd,
			});
			await service.handle(paid(), now);

			await service.handle(
				{ event: 'PAYMENT_REFUNDED', payment: { id: 'pay_1' } },
				now
			);

			expect(subscription().status).toBe('active');
			expect(subscription().currentPeriodEnd).toEqual(currentEnd);
		});

		it('estorno repetido é no-op', async () => {
			await service.handle(paid(), now);
			await service.handle(
				{ event: 'PAYMENT_REFUNDED', payment: { id: 'pay_1' } },
				now
			);

			await expect(
				service.handle(
					{ event: 'PAYMENT_REFUNDED', payment: { id: 'pay_1' } },
					now
				)
			).resolves.toBe('duplicate');
		});

		it('estorno de cobrança nunca paga não mexe em assinatura', async () => {
			userSubscriptions.seed({
				user: userId,
				plan: planId,
				status: 'active',
				currentPeriodEnd: new Date('2026-12-01'),
			});

			await service.handle(
				{ event: 'PAYMENT_DELETED', payment: { id: 'pay_1' } },
				now
			);

			expect(subscription().status).toBe('active');
		});
	});

	it('eventos que não são de pagamento são ignorados', async () => {
		await expect(
			service.handle(
				{ event: 'PAYMENT_CREATED', payment: { id: 'pay_1' } },
				now
			)
		).resolves.toBe('ignored');
		expect(charges.docs[0].status).toBe('pending');
	});
});
