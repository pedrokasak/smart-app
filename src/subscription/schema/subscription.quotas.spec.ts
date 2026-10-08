import { SubscriptionModel } from './subscription.model';
import {
	normalizePlanQuotas,
	planQuotaLimit,
} from '../application/plan-quotas';

/**
 * A cota depende de o Mongoose distinguir `null` (ilimitado) de ausente
 * (o admin não decidiu). Testado no schema real, sem banco (TRA-197).
 */
describe('Subscription.quotas no schema (TRA-197)', () => {
	const base = { name: 'Plano', price: 10, currency: 'brl' };

	it('plano sem cotas não ganha um objeto vazio por padrão', () => {
		const plan = new SubscriptionModel(base);

		expect(plan.quotas).toBeUndefined();
		expect(plan.toObject().quotas).toBeUndefined();
	});

	it('null gravado fica null e vale ilimitado', () => {
		const plan = new SubscriptionModel(base);
		plan.set('quotas.assets', null);

		expect(plan.quotas?.assets).toBeNull();
		expect(normalizePlanQuotas(plan.quotas)).toEqual({ assets: null });
		expect(planQuotaLimit(normalizePlanQuotas(plan.quotas), 'assets', 0)).toBe(
			null
		);
	});

	it('recurso não enviado continua indefinido e cai no padrão do nível', () => {
		const plan = new SubscriptionModel(base);
		plan.set('quotas.assets', 40);

		expect(plan.quotas?.portfolios).toBeUndefined();
		expect(
			planQuotaLimit(normalizePlanQuotas(plan.quotas), 'portfolios', 0)
		).toBe(1);
		expect(planQuotaLimit(normalizePlanQuotas(plan.quotas), 'assets', 0)).toBe(
			40
		);
	});

	it('limite negativo não passa na validação', () => {
		const plan = new SubscriptionModel(base);
		plan.set('quotas.assets', -1);

		expect(plan.validateSync()?.errors['quotas.assets']).toBeDefined();
	});

	it('zero é válido', () => {
		const plan = new SubscriptionModel(base);
		plan.set('quotas.portfolios', 0);

		expect(plan.validateSync()?.errors['quotas.portfolios']).toBeUndefined();
		expect(plan.quotas?.portfolios).toBe(0);
	});
});
