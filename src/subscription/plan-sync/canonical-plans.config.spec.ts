import { CANONICAL_PLANS, envKeysForSlug } from './canonical-plans.config';

/**
 * Trava de regressão dos preços canônicos (TRA-150).
 *
 * `PlanSyncService` grava `canonical.monthlyPrice` no campo `price` do plano,
 * que é o número exibido na vitrine — enquanto quem cobra é o `stripePriceId`.
 * Os dois podem divergir sem nada quebrar: foi o que aconteceu, com o config
 * em R$ 149/R$ 389 e o Stripe em R$ 14,90/R$ 24,90. Rodar o sync naquele
 * estado publicaria um preço que o Stripe não cobra.
 *
 * Os valores abaixo são o catálogo real da conta Stripe. Se um preço mudar
 * lá, este teste quebra e obriga a atualizar o config junto — que é
 * exatamente o acoplamento que faltava.
 */
const STRIPE_CATALOG = {
	essencial: { monthly: 0, annual: undefined, produto: 'Gratuito' },
	pro: { monthly: 14.9, annual: 149, produto: 'Investidor Pro' },
	premium: { monthly: 24.9, annual: 249, produto: 'Premium' },
} as const;

describe('CANONICAL_PLANS — alinhamento com o catálogo Stripe', () => {
	for (const [slug, esperado] of Object.entries(STRIPE_CATALOG)) {
		it(`${slug} espelha o preço do produto "${esperado.produto}" no Stripe`, () => {
			const plan = CANONICAL_PLANS.find((p) => p.slug === slug);
			expect(plan).toBeDefined();
			expect(plan!.monthlyPrice).toBe(esperado.monthly);
			expect(plan!.annualPrice).toBe(esperado.annual);
		});
	}

	/**
	 * O preço anual do Pro (R$ 149) é numericamente igual ao valor que estava
	 * no campo MENSAL antes da correção. Se alguém reverter por engano, o
	 * mensal volta a 149 e este teste denuncia.
	 */
	it('não confunde o preço anual do Pro com o mensal', () => {
		const pro = CANONICAL_PLANS.find((p) => p.slug === 'pro')!;
		expect(pro.monthlyPrice).not.toBe(pro.annualPrice);
		expect(pro.monthlyPrice).toBeLessThan(pro.annualPrice!);
	});

	it('todo plano cobrado pelo Stripe tem preço mensal e anual definidos', () => {
		for (const plan of CANONICAL_PLANS) {
			if (plan.kind !== 'stripe_subscription') continue;
			expect(plan.monthlyPrice).toBeGreaterThan(0);
			// Sem preço anual o checkout anual é recusado (guarda de TRA-150),
			// então plano cobrado precisa dos dois.
			expect(plan.annualPrice).toBeGreaterThan(plan.monthlyPrice);
		}
	});

	it('gera as chaves de ambiente no formato que o sync lê', () => {
		expect(envKeysForSlug('pro')).toEqual({
			productId: 'STRIPE_PLAN_PRO_PRODUCT_ID',
			monthlyPriceId: 'STRIPE_PLAN_PRO_PRICE_MONTHLY_ID',
			annualPriceId: 'STRIPE_PLAN_PRO_PRICE_ANNUAL_ID',
			annualAmount: 'STRIPE_PLAN_PRO_ANNUAL_AMOUNT',
		});
	});
});
