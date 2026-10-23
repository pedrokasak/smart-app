import { BadRequestException, ConflictException } from '@nestjs/common';
import { SubscriptionRefundService } from './subscription-refund.service';

const DAY = 24 * 60 * 60;
const nowSec = () => Math.floor(Date.now() / 1000);

function stripeCharge(overrides: Record<string, unknown> = {}) {
	return {
		id: 'ch_1',
		amount: 1990,
		currency: 'brl',
		status: 'succeeded',
		created: nowSec() - 2 * DAY,
		amount_refunded: 0,
		...overrides,
	};
}

function build(options: { subscription?: any; charges?: any[] } = {}) {
	const subscription =
		options.subscription === undefined
			? {
					stripeSubscriptionId: 'sub_1',
					stripeCustomerId: 'cus_1',
					status: 'active',
					cancelAtPeriodEnd: false,
					save: jest.fn().mockResolvedValue(undefined),
				}
			: options.subscription;
	const findOne = jest.fn().mockReturnValue({
		sort: jest.fn().mockResolvedValue(subscription),
	});
	const stripe = {
		listCustomerCharges: jest
			.fn()
			.mockResolvedValue(options.charges ?? [stripeCharge()]),
		refundCharge: jest.fn().mockResolvedValue({ id: 're_1' }),
		cancelSubscription: jest.fn().mockResolvedValue({}),
	};
	const service = new SubscriptionRefundService(
		{ findOne } as any,
		stripe as any
	);
	return { service, stripe, subscription, findOne };
}

describe('SubscriptionRefundService', () => {
	describe('checkEligibility', () => {
		it('só olha a assinatura do usuário informado', async () => {
			const { service, findOne } = build();

			await service.checkEligibility('user-1');

			expect(findOne).toHaveBeenCalledWith({
				user: 'user-1',
				status: { $in: ['active', 'trialing', 'past_due'] },
			});
		});

		it('informa valor em reais e prazo quando elegível', async () => {
			const { service } = build();

			const result = await service.checkEligibility('user-1');

			expect(result).toMatchObject({
				eligible: true,
				amount: 19.9,
				currency: 'brl',
				windowDays: 7,
			});
			expect(result.deadline).toEqual(expect.any(String));
		});

		it('sem assinatura ativa devolve o motivo', async () => {
			const { service } = build({ subscription: null });

			await expect(service.checkEligibility('user-1')).resolves.toMatchObject({
				eligible: false,
				reasonCode: 'no_subscription',
			});
		});

		it.each(['asaas_pix', 'manual'])(
			'assinatura %s não passa pelo Stripe',
			async (paymentProvider) => {
				const { service, stripe } = build({
					subscription: {
						stripeSubscriptionId: 'sub_1',
						stripeCustomerId: 'cus_1',
						paymentProvider,
					},
				});

				await expect(service.checkEligibility('user-1')).resolves.toMatchObject(
					{
						eligible: false,
						reasonCode: 'unsupported_provider',
					}
				);
				expect(stripe.listCustomerCharges).not.toHaveBeenCalled();
			}
		);
	});

	describe('refund', () => {
		it('estorna, cancela na hora e registra a auditoria', async () => {
			const { service, stripe, subscription } = build();

			const result = await service.refund('user-1');

			expect(stripe.refundCharge).toHaveBeenCalledWith('ch_1', {
				userId: 'user-1',
				source: 'self_service',
			});
			expect(stripe.cancelSubscription).toHaveBeenCalledWith('sub_1', false);
			expect(subscription.status).toBe('canceled');
			expect(subscription.stripeRefundId).toBe('re_1');
			expect(subscription.refundedAt).toBeInstanceOf(Date);
			expect(subscription.save).toHaveBeenCalled();
			expect(result).toEqual({
				refunded: true,
				refundId: 're_1',
				amount: 19.9,
				currency: 'brl',
				canceled: true,
			});
		});

		it('fora do prazo não toca no Stripe', async () => {
			const { service, stripe } = build({
				charges: [stripeCharge({ created: nowSec() - 8 * DAY })],
			});

			await expect(service.refund('user-1')).rejects.toBeInstanceOf(
				BadRequestException
			);
			expect(stripe.refundCharge).not.toHaveBeenCalled();
			expect(stripe.cancelSubscription).not.toHaveBeenCalled();
		});

		it('segunda tentativa depois do estorno vira conflito', async () => {
			const { service, stripe } = build({
				charges: [stripeCharge({ amount_refunded: 1990 })],
			});

			await expect(service.refund('user-1')).rejects.toBeInstanceOf(
				ConflictException
			);
			expect(stripe.refundCharge).not.toHaveBeenCalled();
		});

		it('se o cancelamento falha depois do estorno, mantém a assinatura e avisa', async () => {
			const { service, stripe, subscription } = build();
			stripe.cancelSubscription.mockRejectedValue(new Error('stripe down'));

			const result = await service.refund('user-1');

			expect(result.canceled).toBe(false);
			expect(subscription.status).toBe('active');
			expect(subscription.stripeRefundId).toBe('re_1');
			expect(subscription.save).toHaveBeenCalled();
		});

		it('se o estorno falha, nada é cancelado nem gravado', async () => {
			const { service, stripe, subscription } = build();
			stripe.refundCharge.mockRejectedValue(new Error('card_declined'));

			await expect(service.refund('user-1')).rejects.toThrow('card_declined');
			expect(stripe.cancelSubscription).not.toHaveBeenCalled();
			expect(subscription.save).not.toHaveBeenCalled();
		});
	});
});
