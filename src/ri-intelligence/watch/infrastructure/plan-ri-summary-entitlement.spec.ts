import { PlanRiSummaryEntitlement } from 'src/ri-intelligence/watch/infrastructure/plan-ri-summary-entitlement';
import {
	FREE_ACCESS_LEVEL,
	PREMIUM_ACCESS_LEVEL,
	UserPlanResolverPort,
} from 'src/subscription/application/user-plan.types';

describe('PlanRiSummaryEntitlement (TRA-261)', () => {
	let plans: { resolve: jest.Mock; resolveWithCapabilities: jest.Mock };
	let entitlement: PlanRiSummaryEntitlement;

	beforeEach(() => {
		plans = {
			resolve: jest.fn(),
			resolveWithCapabilities: jest.fn(async (userId: string) => {
				if (userId === 'premium') {
					return { tier: PREMIUM_ACCESS_LEVEL, capabilities: [] };
				}
				if (userId === 'custom') {
					// Plano configurado pelo admin, que decidiu sobre a capability.
					return {
						tier: FREE_ACCESS_LEVEL,
						capabilities: ['ri.ai_summary'],
						capabilitiesKnown: ['ri.ai_summary'],
					};
				}
				if (userId === 'broken') throw new Error('mongo fora');
				return { tier: FREE_ACCESS_LEVEL, capabilities: [] };
			}),
		};
		entitlement = new PlanRiSummaryEntitlement(
			plans as unknown as UserPlanResolverPort
		);
	});

	it('uses the same capability rule as the page and the chat', async () => {
		const allowed = await entitlement.usersWithAiSummary([
			'premium',
			'free',
			'custom',
		]);

		expect([...allowed].sort()).toEqual(['custom', 'premium']);
	});

	// Feature paga: na duvida, nega — e o aviso sai do mesmo jeito.
	it('denies a user whose plan cannot be resolved, without failing the others', async () => {
		const allowed = await entitlement.usersWithAiSummary(['broken', 'premium']);

		expect([...allowed]).toEqual(['premium']);
	});

	it('resolves each user once', async () => {
		await entitlement.usersWithAiSummary(['premium', 'premium', 'free']);

		expect(plans.resolveWithCapabilities).toHaveBeenCalledTimes(2);
	});

	it('handles more users than one batch', async () => {
		const users = Array.from({ length: 45 }, (_, i) => `user-${i}`);

		await entitlement.usersWithAiSummary(users);

		expect(plans.resolveWithCapabilities).toHaveBeenCalledTimes(45);
	});
});
