import { StripeService } from './stripe.service';

describe('StripeService.cancelSubscription (TRA-213)', () => {
	const originalKey = process.env.STRIPE_PRIVATE_API_KEY;
	beforeAll(() => {
		process.env.STRIPE_PRIVATE_API_KEY = 'sk_test_fake';
	});
	afterAll(() => {
		process.env.STRIPE_PRIVATE_API_KEY = originalKey;
	});

	function build() {
		const service = new StripeService({} as any, {} as any);
		const stripe = {
			subscriptions: {
				update: jest.fn().mockResolvedValue({ id: 'sub_1' }),
				cancel: jest
					.fn()
					.mockResolvedValue({ id: 'sub_1', status: 'canceled' }),
			},
		};
		(service as any).stripe = stripe;
		return { service, stripe };
	}

	it('ao fim do período agenda o cancelamento', async () => {
		const { service, stripe } = build();

		await service.cancelSubscription('sub_1', true);

		expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', {
			cancel_at_period_end: true,
		});
		expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
	});

	it('imediato cancela de fato no Stripe', async () => {
		const { service, stripe } = build();

		await service.cancelSubscription('sub_1', false);

		expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_1');
		expect(stripe.subscriptions.update).not.toHaveBeenCalled();
	});
});
