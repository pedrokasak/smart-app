import { StripeService } from './stripe.service';

describe('StripeService — reembolso', () => {
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
			charges: { list: jest.fn().mockResolvedValue({ data: [{ id: 'ch_1' }] }) },
			refunds: { create: jest.fn().mockResolvedValue({ id: 're_1' }) },
		};
		(service as any).stripe = stripe;
		return { service, stripe };
	}

	it('estorna a cobrança inteira com chave de idempotência por cobrança', async () => {
		const { service, stripe } = build();

		await service.refundCharge('ch_1', { userId: 'u1' });

		expect(stripe.refunds.create).toHaveBeenCalledWith(
			{
				charge: 'ch_1',
				reason: 'requested_by_customer',
				metadata: { userId: 'u1' },
			},
			{ idempotencyKey: 'self-service-refund:ch_1' }
		);
	});

	it('lista as cobranças do cliente', async () => {
		const { service, stripe } = build();

		await expect(service.listCustomerCharges('cus_1')).resolves.toEqual([
			{ id: 'ch_1' },
		]);
		expect(stripe.charges.list).toHaveBeenCalledWith({
			customer: 'cus_1',
			limit: 100,
		});
	});

	it('cliente de outro modo (teste x live) vira lista vazia', async () => {
		const { service, stripe } = build();
		stripe.charges.list.mockRejectedValue({ code: 'resource_missing' });

		await expect(service.listCustomerCharges('cus_x')).resolves.toEqual([]);
	});

	it('propaga falha de rede em vez de fingir que não há cobranças', async () => {
		const { service, stripe } = build();
		stripe.charges.list.mockRejectedValue(new Error('timeout'));

		await expect(service.listCustomerCharges('cus_1')).rejects.toThrow(
			'timeout'
		);
	});
});
