import { SubscriptionService } from 'src/subscription/subscription.service';
import { SubscriptionUserPlanResolver } from 'src/subscription/application/subscription-user-plan.resolver';
import {
	FREE_ACCESS_LEVEL,
	PREMIUM_ACCESS_LEVEL,
	PRO_ACCESS_LEVEL,
	planAtLeast,
} from 'src/subscription/application/user-plan.types';

const ENTERPRISE_ACCESS_LEVEL = PREMIUM_ACCESS_LEVEL + 10;

describe('SubscriptionUserPlanResolver (TRA-79, TRA-182)', () => {
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

		await expect(resolver.resolve('user-1')).resolves.toBe(
			PREMIUM_ACCESS_LEVEL
		);
		expect(
			subscriptionService.findCurrentSubscriptionByUser
		).toHaveBeenCalledWith('user-1');
	});

	it('uses the access level stored on the plan, so renaming the plan keeps the access', async () => {
		subscriptionService.findCurrentSubscriptionByUser.mockResolvedValue({
			plan: { name: 'Plano Ouro', accessLevel: PREMIUM_ACCESS_LEVEL },
		});

		await expect(resolver.resolve('user-1')).resolves.toBe(
			PREMIUM_ACCESS_LEVEL
		);
	});

	it('accepts a custom level that sits between the usual patamares', async () => {
		// TRA-182: nao ha lista fixa de niveis — o admin pode criar um plano
		// intermediario com qualquer numero.
		subscriptionService.findCurrentSubscriptionByUser.mockResolvedValue({
			plan: { name: 'Plano Intermediário', accessLevel: 15 },
		});

		await expect(resolver.resolve('user-1')).resolves.toBe(15);
	});

	it('falls back to free when the user has no active subscription', async () => {
		// findCurrentSubscriptionByUser ja filtra por active/trialing, entao
		// assinatura cancelada ou vencida chega aqui como null.
		subscriptionService.findCurrentSubscriptionByUser.mockResolvedValue(null);

		await expect(resolver.resolve('user-1')).resolves.toBe(FREE_ACCESS_LEVEL);
	});

	it('falls back to free when the lookup throws, never opening access by accident', async () => {
		subscriptionService.findCurrentSubscriptionByUser.mockRejectedValue(
			new Error('mongo down')
		);

		await expect(resolver.resolve('user-1')).resolves.toBe(FREE_ACCESS_LEVEL);
	});

	it('returns free for an empty userId without querying', async () => {
		await expect(resolver.resolve('')).resolves.toBe(FREE_ACCESS_LEVEL);
		expect(
			subscriptionService.findCurrentSubscriptionByUser
		).not.toHaveBeenCalled();
	});

	describe('tierFromPlanName (fallback legado por nome)', () => {
		it.each([
			['Plano Premium', PREMIUM_ACCESS_LEVEL],
			['premium', PREMIUM_ACCESS_LEVEL],
			['Plano Pro', PRO_ACCESS_LEVEL],
			['PRO', PRO_ACCESS_LEVEL],
			['Global Investor', ENTERPRISE_ACCESS_LEVEL],
			['Plano Global', ENTERPRISE_ACCESS_LEVEL],
			['Enterprise', ENTERPRISE_ACCESS_LEVEL],
			['Trackerr Enterprise', ENTERPRISE_ACCESS_LEVEL],
			['Plano Gratuito', FREE_ACCESS_LEVEL],
			['', FREE_ACCESS_LEVEL],
		])('maps %s to %s', (name, expected) => {
			expect(SubscriptionUserPlanResolver.tierFromPlanName(name)).toBe(
				expected
			);
		});

		it('prefers the enterprise level when a name could match two tiers', async () => {
			// "Global Investor Premium" contem os dois; o maior tem que vencer,
			// senao o cliente do plano mais caro perde acesso.
			expect(
				SubscriptionUserPlanResolver.tierFromPlanName('Global Investor Premium')
			).toBe(ENTERPRISE_ACCESS_LEVEL);
		});

		it('handles null and undefined as free', () => {
			expect(SubscriptionUserPlanResolver.tierFromPlanName(null)).toBe(
				FREE_ACCESS_LEVEL
			);
			expect(SubscriptionUserPlanResolver.tierFromPlanName(undefined)).toBe(
				FREE_ACCESS_LEVEL
			);
		});
	});

	describe('planAtLeast', () => {
		it('compares access levels numerically, sem depender de nomes fixos', () => {
			expect(planAtLeast(PREMIUM_ACCESS_LEVEL, PRO_ACCESS_LEVEL)).toBe(true);
			expect(planAtLeast(PRO_ACCESS_LEVEL, PREMIUM_ACCESS_LEVEL)).toBe(false);
			expect(planAtLeast(15, PRO_ACCESS_LEVEL)).toBe(true);
			expect(planAtLeast(15, PREMIUM_ACCESS_LEVEL)).toBe(false);
			expect(
				planAtLeast(ENTERPRISE_ACCESS_LEVEL, ENTERPRISE_ACCESS_LEVEL)
			).toBe(true);
			expect(planAtLeast(FREE_ACCESS_LEVEL, PRO_ACCESS_LEVEL)).toBe(false);
		});
	});
});
