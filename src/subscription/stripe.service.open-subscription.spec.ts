import { StripeService } from './stripe.service';

/** TRA-246: evitar duas assinaturas cobrando o mesmo cliente. */
describe('StripeService.hasOpenSubscription', () => {
	const originalKey = process.env.STRIPE_PRIVATE_API_KEY;
	beforeAll(() => {
		process.env.STRIPE_PRIVATE_API_KEY = 'sk_test_fake';
	});
	afterAll(() => {
		process.env.STRIPE_PRIVATE_API_KEY = originalKey;
	});

	function build(list: jest.Mock) {
		const service = new StripeService({} as any, {} as any);
		(service as any).stripe = { subscriptions: { list } };
		return service;
	}

	const withStatuses = (...statuses: string[]) =>
		jest
			.fn()
			.mockResolvedValue({ data: statuses.map((status) => ({ status })) });

	it.each(['active', 'trialing', 'past_due', 'unpaid', 'incomplete'])(
		'assinatura %s conta como aberta',
		async (status) => {
			const list = withStatuses('canceled', status);

			await expect(build(list).hasOpenSubscription('cus_1')).resolves.toBe(
				true
			);
			expect(list).toHaveBeenCalledWith({
				customer: 'cus_1',
				status: 'all',
				limit: 20,
			});
		}
	);

	it('só encerradas ou expiradas não bloqueiam', async () => {
		const list = withStatuses('canceled', 'incomplete_expired');

		await expect(build(list).hasOpenSubscription('cus_1')).resolves.toBe(false);
	});

	it('cliente de outro modo (teste x live) não tem assinatura aqui', async () => {
		const list = jest.fn().mockRejectedValue({ code: 'resource_missing' });

		await expect(build(list).hasOpenSubscription('cus_x')).resolves.toBe(false);
	});

	it('falha do Stripe sobe, sem liberar um checkout às cegas', async () => {
		const list = jest.fn().mockRejectedValue(new Error('stripe fora'));

		await expect(build(list).hasOpenSubscription('cus_1')).rejects.toThrow(
			'stripe fora'
		);
	});
});
