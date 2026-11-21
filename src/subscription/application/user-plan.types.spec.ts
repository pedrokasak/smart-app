import {
	ADVISOR_PORTAL_ACCESS_LEVEL,
	ALL_PLAN_CAPABILITIES,
	CAPABILITY_DEFAULT_LEVEL,
	FREE_ACCESS_LEVEL,
	PREMIUM_ACCESS_LEVEL,
	PLAN_CAPABILITY_LABELS,
	PRO_ACCESS_LEVEL,
	planHasCapability,
} from 'src/subscription/application/user-plan.types';

describe('planHasCapability (TRA-189)', () => {
	it('manda a capability explícita do admin, mesmo contrariando o accessLevel', () => {
		// Admin liberou 'broker.sync' num plano com accessLevel abaixo do
		// patamar padrão — o checkbox do painel vence.
		expect(
			planHasCapability(['broker.sync'], 'broker.sync', FREE_ACCESS_LEVEL)
		).toBe(true);
	});

	it('nega quando o admin configurou capabilities e a chave não está na lista', () => {
		// Plano com accessLevel de Premium, mas o admin desmarcou
		// explicitamente 'ai.insights' — a lista curada vence.
		expect(
			planHasCapability(['broker.sync'], 'ai.insights', PREMIUM_ACCESS_LEVEL)
		).toBe(false);
	});

	it('cai no fallback por accessLevel quando capabilities nunca foi configurado (undefined)', () => {
		expect(planHasCapability(undefined, 'broker.sync', PRO_ACCESS_LEVEL)).toBe(
			true
		);
		expect(planHasCapability(undefined, 'broker.sync', FREE_ACCESS_LEVEL)).toBe(
			false
		);
	});

	it('cai no fallback por accessLevel quando capabilities é uma lista vazia', () => {
		expect(planHasCapability([], 'ai.insights', PREMIUM_ACCESS_LEVEL)).toBe(
			true
		);
		expect(planHasCapability([], 'ai.insights', PRO_ACCESS_LEVEL)).toBe(false);
	});

	it('cai no fallback por accessLevel quando capabilities é null', () => {
		expect(planHasCapability(null, 'fiscal.ir_report', PRO_ACCESS_LEVEL)).toBe(
			true
		);
	});

	it('cada capability tem um patamar padrão definido', () => {
		for (const capability of ALL_PLAN_CAPABILITIES) {
			expect(typeof CAPABILITY_DEFAULT_LEVEL[capability]).toBe('number');
		}
	});
});

describe('advisor.portal (Trackerr Advisor P3a, U4)', () => {
	it('is a known capability with its own label', () => {
		expect(ALL_PLAN_CAPABILITIES).toContain('advisor.portal');
		expect(PLAN_CAPABILITY_LABELS['advisor.portal']).toBe('Portal do assessor');
		expect(CAPABILITY_DEFAULT_LEVEL['advisor.portal']).toBe(
			ADVISOR_PORTAL_ACCESS_LEVEL
		);
	});

	it('no tier reaches the default level, so an unconfigured plan never opens the portal', () => {
		for (const tier of [
			FREE_ACCESS_LEVEL,
			PRO_ACCESS_LEVEL,
			PREMIUM_ACCESS_LEVEL,
			Number.MAX_SAFE_INTEGER,
		]) {
			expect(planHasCapability([], 'advisor.portal', tier)).toBe(false);
		}
	});

	it('a plan configured before the key existed does not open the portal', () => {
		const knownBefore = ALL_PLAN_CAPABILITIES.filter(
			(c) => c !== 'advisor.portal'
		);
		expect(
			planHasCapability(
				['ai.insights'],
				'advisor.portal',
				PREMIUM_ACCESS_LEVEL,
				knownBefore
			)
		).toBe(false);
	});

	it('opens the portal only when the admin ticks it on the plan', () => {
		expect(
			planHasCapability(
				['advisor.portal'],
				'advisor.portal',
				FREE_ACCESS_LEVEL,
				ALL_PLAN_CAPABILITIES
			)
		).toBe(true);
	});
});
