import {
	ALL_PLAN_CAPABILITIES,
	CAPABILITY_DEFAULT_LEVEL,
	FREE_ACCESS_LEVEL,
	PREMIUM_ACCESS_LEVEL,
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
