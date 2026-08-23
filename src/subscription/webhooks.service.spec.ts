import { WebhooksService } from 'src/subscription/webhooks.service';

// Foca no bug de ponta a ponta corrigido: assinante ANUAL chega no webhook
// com um price.id que esta em annualStripePriceId, nao em stripePriceId.
describe('WebhooksService — resolução de plano no webhook', () => {
	let subscriptionModel: { findOne: jest.Mock };
	let userModel: { findOne: jest.Mock };
	let savedDocs: any[];
	let userSubscriptionModel: any;
	let service: WebhooksService;

	function makeSubscriptionEvent(priceId: string) {
		return {
			type: 'customer.subscription.created',
			data: {
				object: {
					id: 'sub_123',
					customer: 'cus_123',
					status: 'active',
					cancel_at_period_end: false,
					items: {
						data: [
							{
								quantity: 1,
								price: { id: priceId },
								current_period_start: 1_700_000_000,
								current_period_end: 1_702_000_000,
							},
						],
					},
				},
			},
		} as any;
	}

	beforeEach(() => {
		savedDocs = [];
		subscriptionModel = { findOne: jest.fn() };
		userModel = { findOne: jest.fn().mockResolvedValue({ _id: 'user_1' }) };
		// Model usado como construtor: `new this.userSubscriptionModel(doc)`.
		userSubscriptionModel = jest.fn().mockImplementation((doc: any) => ({
			...doc,
			save: jest.fn().mockImplementation(function (this: any) {
				savedDocs.push(doc);
				return Promise.resolve(doc);
			}),
		}));
		userSubscriptionModel.findOne = jest.fn().mockResolvedValue(null);

		service = new WebhooksService(
			userModel as never,
			subscriptionModel as never,
			userSubscriptionModel as never
		);
	});

	it('creates a UserSubscription for a MONTHLY subscriber (stripePriceId match)', async () => {
		subscriptionModel.findOne.mockResolvedValue({ _id: 'plan_pro' });

		await service.handleWebhook(makeSubscriptionEvent('price_monthly_pro'));

		expect(savedDocs).toHaveLength(1);
		expect(savedDocs[0].plan).toBe('plan_pro');
	});

	it('creates a UserSubscription for an ANNUAL subscriber (annualStripePriceId match)', async () => {
		// Regressão: antes o webhook so procurava por stripePriceId, entao o
		// preco anual nunca casava e o assinante ficava sem UserSubscription.
		subscriptionModel.findOne.mockResolvedValue({ _id: 'plan_pro' });

		await service.handleWebhook(makeSubscriptionEvent('price_annual_pro'));

		// O plano tem que ser buscado com um $or cobrindo os dois campos.
		const query = subscriptionModel.findOne.mock.calls[0][0];
		expect(query.$or).toEqual(
			expect.arrayContaining([
				{ stripePriceId: 'price_annual_pro' },
				{ annualStripePriceId: 'price_annual_pro' },
			])
		);
		expect(savedDocs).toHaveLength(1);
		expect(savedDocs[0].plan).toBe('plan_pro');
	});

	it('does not create a subscription when no plan matches the price', async () => {
		subscriptionModel.findOne.mockResolvedValue(null);

		await service.handleWebhook(makeSubscriptionEvent('price_desconhecido'));

		expect(savedDocs).toHaveLength(0);
	});
});
