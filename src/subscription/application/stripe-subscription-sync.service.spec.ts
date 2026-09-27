import { Types } from 'mongoose';
import { StripeSubscriptionSyncService } from './stripe-subscription-sync.service';

describe('StripeSubscriptionSyncService', () => {
	const USER = '6ab88b1a00dd1ed43ab6b223';
	let subscriptionModel: { findOne: jest.Mock };
	let userSubscriptionModel: { updateOne: jest.Mock };
	let service: StripeSubscriptionSyncService;

	const stripeSubscription = (priceId = 'price_pro', status = 'active') =>
		({
			id: 'sub_1',
			customer: 'cus_1',
			status,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						quantity: 1,
						price: { id: priceId },
						current_period_start: 1_790_480_264,
						current_period_end: 1_793_072_264,
					},
				],
			},
		}) as never;

	beforeEach(() => {
		subscriptionModel = {
			findOne: jest.fn().mockResolvedValue({ _id: 'plan_pro' }),
		};
		userSubscriptionModel = { updateOne: jest.fn().mockResolvedValue({}) };
		service = new StripeSubscriptionSyncService(
			subscriptionModel as never,
			userSubscriptionModel as never
		);
	});

	it('grava a assinatura do Stripe para o usuário, com período do item', async () => {
		await expect(
			service.syncForUser(USER, stripeSubscription())
		).resolves.toEqual({
			synced: true,
			status: 'active',
		});

		const [filter, update, options] =
			userSubscriptionModel.updateOne.mock.calls[0];
		expect(filter).toEqual({
			stripeSubscriptionId: 'sub_1',
			user: new Types.ObjectId(USER),
		});
		expect(update.$set).toMatchObject({
			plan: 'plan_pro',
			stripeCustomerId: 'cus_1',
			paymentProvider: 'stripe',
			status: 'active',
			currentPeriodEnd: new Date(1_793_072_264 * 1000),
		});
		expect(update.$setOnInsert.stripeSubscriptionId).toBe('sub_1');
		expect(options).toEqual({ upsert: true });
	});

	it('acha o plano pelo preço mensal ou anual', async () => {
		await service.syncForUser(USER, stripeSubscription('price_annual'));

		expect(subscriptionModel.findOne).toHaveBeenCalledWith({
			$or: [
				{ stripePriceId: 'price_annual' },
				{ annualStripePriceId: 'price_annual' },
			],
		});
	});

	it('preço sem plano não grava nada', async () => {
		subscriptionModel.findOne.mockResolvedValue(null);

		await expect(
			service.syncForUser(USER, stripeSubscription())
		).resolves.toEqual({
			synced: false,
			reason: 'unknown_price',
		});
		expect(userSubscriptionModel.updateOne).not.toHaveBeenCalled();
	});

	it('nunca reatribui uma assinatura que já é de outro usuário', async () => {
		userSubscriptionModel.updateOne.mockRejectedValue({ code: 11000 });

		await expect(
			service.syncForUser(USER, stripeSubscription())
		).resolves.toEqual({
			synced: false,
			reason: 'owned_by_another_user',
		});
	});

	it('outros erros do banco sobem', async () => {
		userSubscriptionModel.updateOne.mockRejectedValue(new Error('mongo fora'));

		await expect(
			service.syncForUser(USER, stripeSubscription())
		).rejects.toThrow('mongo fora');
	});
});
