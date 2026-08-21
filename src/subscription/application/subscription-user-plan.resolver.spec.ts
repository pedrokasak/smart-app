import { SubscriptionService } from 'src/subscription/subscription.service';
import { SubscriptionUserPlanResolver } from 'src/subscription/application/subscription-user-plan.resolver';
import { planAtLeast } from 'src/subscription/application/user-plan.types';

describe('SubscriptionUserPlanResolver (TRA-79)', () => {
	let subscriptionService: { findCurrentSubscriptionByUser: jest.Mock };
	let resolver: SubscriptionUserPlanResolver;

	beforeEach(() => {
		subscriptionService = { findCurrentSubscriptionByUser: jest.fn() };
		resolver = new SubscriptionUserPlanResolver(
			subscriptionService as unknown as SubscriptionService
		);
	});

	it('reads the plan from the active subscription, not from portfolios', async () => {
		subscriptionService.findCurrentSubscriptionByUser.mockResolvedValue({
			plan: { name: 'Plano Premium' },
		});

		await expect(resolver.resolve('user-1')).resolves.toBe('premium');
		expect(
			subscriptionService.findCurrentSubscriptionByUser
		).toHaveBeenCalledWith('user-1');
	});

	it('falls back to free when the user has no active subscription', async () => {
		// findCurrentSubscriptionByUser ja filtra por active/trialing, entao
		// assinatura cancelada ou vencida chega aqui como null.
		subscriptionService.findCurrentSubscriptionByUser.mockResolvedValue(null);

		await expect(resolver.resolve('user-1')).resolves.toBe('free');
	});

	it('falls back to free when the lookup throws, never opening access by accident', async () => {
		subscriptionService.findCurrentSubscriptionByUser.mockRejectedValue(
			new Error('mongo down')
		);

		await expect(resolver.resolve('user-1')).resolves.toBe('free');
	});

	it('returns free for an empty userId without querying', async () => {
		await expect(resolver.resolve('')).resolves.toBe('free');
		expect(
			subscriptionService.findCurrentSubscriptionByUser
		).not.toHaveBeenCalled();
	});

	describe('tierFromPlanName', () => {
		it.each([
			['Plano Premium', 'premium'],
			['premium', 'premium'],
			['Plano Pro', 'pro'],
			['PRO', 'pro'],
			['Global Investor', 'global_investor'],
			['Plano Global', 'global_investor'],
			['Plano Gratuito', 'free'],
			['', 'free'],
		])('maps %s to %s', (name, expected) => {
			expect(SubscriptionUserPlanResolver.tierFromPlanName(name)).toBe(
				expected
			);
		});

		it('prefers global_investor when a name could match two tiers', async () => {
			// "Global Investor Premium" contem os dois; o maior tem que vencer,
			// senao o cliente do plano mais caro perde acesso.
			expect(
				SubscriptionUserPlanResolver.tierFromPlanName('Global Investor Premium')
			).toBe('global_investor');
		});

		it('handles null and undefined as free', () => {
			expect(SubscriptionUserPlanResolver.tierFromPlanName(null)).toBe('free');
			expect(SubscriptionUserPlanResolver.tierFromPlanName(undefined)).toBe(
				'free'
			);
		});
	});

	describe('planAtLeast', () => {
		it('orders the tiers by access level', () => {
			expect(planAtLeast('premium', 'pro')).toBe(true);
			expect(planAtLeast('pro', 'premium')).toBe(false);
			expect(planAtLeast('global_investor', 'global_investor')).toBe(true);
			expect(planAtLeast('free', 'pro')).toBe(false);
		});
	});
});
