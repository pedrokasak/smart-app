import { WebhooksService } from 'src/subscription/webhooks.service';

// Foca no bug de ponta a ponta corrigido: assinante ANUAL chega no webhook
// com um price.id que esta em annualStripePriceId, nao em stripePriceId.
describe('WebhooksService — resolução de plano no webhook', () => {
	let subscriptionModel: { findOne: jest.Mock };
	let userModel: { findOne: jest.Mock };
	let userSubscriptionModel: any;
	let service: WebhooksService;

	/** Documentos que o upsert atômico gravou de fato. */
	function upsertedDocs(): any[] {
		return userSubscriptionModel.updateOne.mock.calls
			.filter((call: any[]) => call[2]?.upsert)
			.map((call: any[]) => call[1].$setOnInsert);
	}

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
		subscriptionModel = { findOne: jest.fn() };
		userModel = { findOne: jest.fn().mockResolvedValue({ _id: 'user_1' }) };
		userSubscriptionModel = {
			findOne: jest.fn().mockResolvedValue(null),
			// upsertedCount 1 = o documento foi criado por esta chamada.
			updateOne: jest.fn().mockResolvedValue({ upsertedCount: 1 }),
		};

		service = new WebhooksService(
			userModel as never,
			subscriptionModel as never,
			userSubscriptionModel as never
		);
	});

	it('creates a UserSubscription for a MONTHLY subscriber (stripePriceId match)', async () => {
		subscriptionModel.findOne.mockResolvedValue({ _id: 'plan_pro' });

		await service.handleWebhook(makeSubscriptionEvent('price_monthly_pro'));

		expect(upsertedDocs()).toHaveLength(1);
		expect(upsertedDocs()[0].plan).toBe('plan_pro');
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
		expect(upsertedDocs()).toHaveLength(1);
		expect(upsertedDocs()[0].plan).toBe('plan_pro');
	});

	it('does not create a subscription when no plan matches the price', async () => {
		subscriptionModel.findOne.mockResolvedValue(null);

		await service.handleWebhook(makeSubscriptionEvent('price_desconhecido'));

		expect(userSubscriptionModel.updateOne).not.toHaveBeenCalled();
	});

	it('grava a assinatura por upsert, e não por leitura seguida de escrita', async () => {
		// TRA-89: o Stripe reentrega e paraleliza eventos. Com `findOne` e
		// depois `save`, duas entregas do mesmo evento criavam dois
		// UserSubscription pro mesmo stripeSubscriptionId.
		subscriptionModel.findOne.mockResolvedValue({ _id: 'plan_pro' });

		await service.handleWebhook(makeSubscriptionEvent('price_monthly_pro'));

		const [filter, , options] = userSubscriptionModel.updateOne.mock.calls[0];
		expect(filter).toEqual({ stripeSubscriptionId: 'sub_123' });
		expect(options.upsert).toBe(true);
	});

	it('não recria a assinatura quando o evento é reentregue', async () => {
		subscriptionModel.findOne.mockResolvedValue({ _id: 'plan_pro' });
		// upsertedCount 0 = outra entrega já criou o documento.
		userSubscriptionModel.updateOne.mockResolvedValue({ upsertedCount: 0 });

		await expect(
			service.handleWebhook(makeSubscriptionEvent('price_monthly_pro'))
		).resolves.toBeUndefined();
	});
});
