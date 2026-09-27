import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CheckoutConfirmationService } from './checkout-confirmation.service';

/** Incidente 27/09/2026: pagamento aprovado não liberava o plano sem webhook. */
describe('CheckoutConfirmationService', () => {
	const USER = '6ab88b1a00dd1ed43ab6b223';
	const subscription = { id: 'sub_1', status: 'active' };

	let stripe: {
		checkout: { sessions: { retrieve: jest.Mock } };
		subscriptions: { retrieve: jest.Mock };
	};
	let sync: { syncForUser: jest.Mock };
	let service: CheckoutConfirmationService;

	const paidSession = (overrides: Record<string, unknown> = {}) => ({
		id: 'cs_live_1',
		mode: 'subscription',
		status: 'complete',
		payment_status: 'paid',
		metadata: { userId: USER },
		subscription,
		...overrides,
	});

	beforeEach(() => {
		stripe = {
			checkout: { sessions: { retrieve: jest.fn() } },
			subscriptions: { retrieve: jest.fn() },
		};
		sync = {
			syncForUser: jest
				.fn()
				.mockResolvedValue({ synced: true, status: 'active' }),
		};
		service = new CheckoutConfirmationService(stripe as never, sync as never);
	});

	it('sessão paga do próprio usuário libera o plano', async () => {
		stripe.checkout.sessions.retrieve.mockResolvedValue(paidSession());

		await expect(service.confirmForUser(USER, 'cs_live_1')).resolves.toEqual({
			state: 'confirmed',
			subscriptionStatus: 'active',
		});
		expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith(
			'cs_live_1',
			{
				expand: ['subscription'],
			}
		);
		expect(sync.syncForUser).toHaveBeenCalledWith(USER, subscription);
	});

	it('pagamento com cupom de 100% (no_payment_required) também libera', async () => {
		stripe.checkout.sessions.retrieve.mockResolvedValue(
			paidSession({ payment_status: 'no_payment_required' })
		);

		await expect(
			service.confirmForUser(USER, 'cs_live_1')
		).resolves.toMatchObject({
			state: 'confirmed',
		});
	});

	it('sessão de outro usuário responde como inexistente e não grava nada', async () => {
		stripe.checkout.sessions.retrieve.mockResolvedValue(
			paidSession({ metadata: { userId: 'outro' } })
		);

		await expect(service.confirmForUser(USER, 'cs_live_1')).rejects.toThrow(
			NotFoundException
		);
		expect(sync.syncForUser).not.toHaveBeenCalled();
	});

	it('sessão inexistente no Stripe vira 404', async () => {
		stripe.checkout.sessions.retrieve.mockRejectedValue({
			code: 'resource_missing',
		});

		await expect(service.confirmForUser(USER, 'cs_live_x')).rejects.toThrow(
			NotFoundException
		);
	});

	it('sessão que não é de assinatura é recusada', async () => {
		stripe.checkout.sessions.retrieve.mockResolvedValue(
			paidSession({ mode: 'payment' })
		);

		await expect(service.confirmForUser(USER, 'cs_live_1')).rejects.toThrow(
			BadRequestException
		);
	});

	it('boleto gerado e ainda não pago fica pendente, sem liberar', async () => {
		stripe.checkout.sessions.retrieve.mockResolvedValue(
			paidSession({ payment_status: 'unpaid' })
		);

		await expect(service.confirmForUser(USER, 'cs_live_1')).resolves.toEqual({
			state: 'pending_payment',
		});
		expect(sync.syncForUser).not.toHaveBeenCalled();
	});

	it('checkout não concluído não libera', async () => {
		stripe.checkout.sessions.retrieve.mockResolvedValue(
			paidSession({ status: 'open', payment_status: 'unpaid' })
		);

		await expect(service.confirmForUser(USER, 'cs_live_1')).resolves.toEqual({
			state: 'not_completed',
		});
	});

	it('busca a assinatura quando a sessão traz só o id', async () => {
		stripe.checkout.sessions.retrieve.mockResolvedValue(
			paidSession({ subscription: 'sub_1' })
		);
		stripe.subscriptions.retrieve.mockResolvedValue(subscription);

		await service.confirmForUser(USER, 'cs_live_1');

		expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1');
		expect(sync.syncForUser).toHaveBeenCalledWith(USER, subscription);
	});

	it('assinatura ainda incompleta no Stripe fica pendente', async () => {
		stripe.checkout.sessions.retrieve.mockResolvedValue(paidSession());
		sync.syncForUser.mockResolvedValue({ synced: true, status: 'past_due' });

		await expect(service.confirmForUser(USER, 'cs_live_1')).resolves.toEqual({
			state: 'pending_payment',
		});
	});

	it('plano sem preço mapeado vira falha explícita', async () => {
		stripe.checkout.sessions.retrieve.mockResolvedValue(paidSession());
		sync.syncForUser.mockResolvedValue({
			synced: false,
			reason: 'unknown_price',
		});

		await expect(service.confirmForUser(USER, 'cs_live_1')).resolves.toEqual({
			state: 'failed',
		});
	});

	it('pelo webhook, sessão sem metadata.userId é ignorada', async () => {
		await expect(
			service.applySession(paidSession({ metadata: {} }) as never)
		).resolves.toEqual({ state: 'failed' });
		expect(sync.syncForUser).not.toHaveBeenCalled();
	});
});
