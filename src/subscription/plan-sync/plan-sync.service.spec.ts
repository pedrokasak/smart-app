import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { PlanSyncService } from './plan-sync.service';

jest.mock('../../env.ts', () => ({
	jwtSecret: 'test-secret',
}));

/**
 * Estes testes cobrem a garantia central pedida pela TRA-18:
 *   "plano carrega tanto os preços quanto os IDs Stripe correspondentes".
 * Também travam a idempotência do seed — uma segunda passada não muda nada.
 */
describe('PlanSyncService', () => {
	let service: PlanSyncService;
	let plans: any[];
	let userSubs: any[];
	let subscriptionModel: any;
	let userSubscriptionModel: any;

	const env = {
		STRIPE_PLAN_PRO_PRODUCT_ID: 'prod_pro_live',
		STRIPE_PLAN_PRO_PRICE_MONTHLY_ID: 'price_pro_monthly_live',
		STRIPE_PLAN_PRO_PRICE_ANNUAL_ID: 'price_pro_annual_live',
		STRIPE_PLAN_PRO_ANNUAL_AMOUNT: '1490',
		STRIPE_PLAN_PREMIUM_PRODUCT_ID: 'prod_premium_live',
		STRIPE_PLAN_PREMIUM_PRICE_MONTHLY_ID: 'price_premium_monthly_live',
		STRIPE_PLAN_PREMIUM_PRICE_ANNUAL_ID: 'price_premium_annual_live',
		STRIPE_PLAN_PREMIUM_ANNUAL_AMOUNT: '3890',
	} satisfies NodeJS.ProcessEnv;

	beforeEach(async () => {
		plans = [];
		userSubs = [];

		subscriptionModel = {
			find: jest.fn(() => ({ lean: () => Promise.resolve(plans) })),
			create: jest.fn(async (doc) => {
				const created = { _id: `plan_${plans.length + 1}`, ...doc };
				plans.push(created);
				return created;
			}),
			updateOne: jest.fn(async (filter, update) => {
				const target = plans.find(
					(p) => String(p._id) === String(filter._id)
				);
				if (target) Object.assign(target, update.$set);
				return { acknowledged: true };
			}),
		};

		userSubscriptionModel = {
			aggregate: jest.fn(async () => userSubs),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				PlanSyncService,
				{
					provide: getModelToken('Subscription'),
					useValue: subscriptionModel,
				},
				{
					provide: getModelToken('UserSubscription'),
					useValue: userSubscriptionModel,
				},
			],
		}).compile();

		service = module.get(PlanSyncService);
	});

	it('cria planos canônicos zerados carregando preço mensal, anual e IDs Stripe', async () => {
		const report = await service.syncCanonicalPlans({ env });

		const pro = report.plans.find((p) => p.slug === 'pro')!;
		expect(pro.action).toBe('created');

		const proDoc = plans.find((p) => p.name === 'Pro');
		expect(proDoc).toMatchObject({
			name: 'Pro',
			price: 149,
			annualPrice: 1490,
			stripeProductId: 'prod_pro_live',
			stripePriceId: 'price_pro_monthly_live',
			annualStripePriceId: 'price_pro_annual_live',
			currency: 'brl',
			interval: 'month',
			isActive: true,
		});

		const premiumDoc = plans.find((p) => p.name === 'Wealth Premium');
		expect(premiumDoc).toMatchObject({
			stripeProductId: 'prod_premium_live',
			stripePriceId: 'price_premium_monthly_live',
			annualStripePriceId: 'price_premium_annual_live',
			annualPrice: 3890,
		});
	});

	it('é idempotente: uma segunda passada não emite update', async () => {
		await service.syncCanonicalPlans({ env });
		subscriptionModel.updateOne.mockClear();
		subscriptionModel.create.mockClear();

		const second = await service.syncCanonicalPlans({ env });

		expect(subscriptionModel.create).not.toHaveBeenCalled();
		expect(subscriptionModel.updateOne).not.toHaveBeenCalled();
		expect(second.plans.every((p) => p.action === 'unchanged')).toBe(true);
	});

	it('casa plano legado pelo alias e preserva o _id existente', async () => {
		plans.push({
			_id: 'legacy_pro_1',
			name: 'Plano Destaque',
			price: 199,
			currency: 'brl',
			interval: 'month',
			intervalCount: 1,
			isActive: true,
			stripeProductId: 'prod_legacy',
			stripePriceId: 'price_legacy',
			features: ['algo antigo'],
		});

		const report = await service.syncCanonicalPlans({ env });
		const pro = report.plans.find((p) => p.slug === 'pro')!;

		expect(pro.action).toBe('updated');
		expect(pro.matchedBy).toBe('alias');
		expect(pro.planId).toBe('legacy_pro_1');

		const updated = plans.find((p) => p._id === 'legacy_pro_1');
		expect(updated).toMatchObject({
			name: 'Pro',
			price: 149,
			stripeProductId: 'prod_pro_live',
			stripePriceId: 'price_pro_monthly_live',
			annualStripePriceId: 'price_pro_annual_live',
			annualPrice: 1490,
		});
	});

	it('emite TODO quando o env do Stripe está faltando e NÃO inventa IDs', async () => {
		const partialEnv = {
			STRIPE_PLAN_PRO_PRODUCT_ID: 'prod_pro_live',
			STRIPE_PLAN_PRO_PRICE_MONTHLY_ID: 'price_pro_monthly_live',
			// sem STRIPE_PLAN_PRO_PRICE_ANNUAL_ID
		} satisfies NodeJS.ProcessEnv;

		const report = await service.syncCanonicalPlans({ env: partialEnv });
		const pro = report.plans.find((p) => p.slug === 'pro')!;

		expect(pro.todos.some((t) => t.includes('ANNUAL'))).toBe(true);
		const proDoc = plans.find((p) => p.name === 'Pro');
		expect(proDoc.annualStripePriceId).toBeUndefined();
		expect(report.todos.length).toBeGreaterThan(0);
	});

	it('desativa plano legado sem assinantes ativos', async () => {
		plans.push({
			_id: 'legacy_random',
			name: 'Plano Antigo Sem Match',
			isActive: true,
		});

		const report = await service.syncCanonicalPlans({ env });
		const legacy = report.legacy.find((l) => l.planId === 'legacy_random');
		expect(legacy?.action).toBe('deactivated');
		expect(plans.find((p) => p._id === 'legacy_random').isActive).toBe(false);
	});

	it('preserva plano legado que ainda tem assinantes ativos', async () => {
		plans.push({
			_id: 'legacy_with_users',
			name: 'Plano Antigo Ativo',
			isActive: true,
		});
		userSubs.push({ _id: 'legacy_with_users', count: 3 });

		const report = await service.syncCanonicalPlans({ env });
		const legacy = report.legacy.find(
			(l) => l.planId === 'legacy_with_users'
		);
		expect(legacy?.action).toBe('kept-active');
		expect(legacy?.activeSubscribers).toBe(3);
		expect(plans.find((p) => p._id === 'legacy_with_users').isActive).toBe(
			true
		);
	});

	it('dry-run não persiste nada', async () => {
		await service.syncCanonicalPlans({ env, dryRun: true });
		expect(subscriptionModel.create).not.toHaveBeenCalled();
		expect(subscriptionModel.updateOne).not.toHaveBeenCalled();
	});
});
