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
		STRIPE_PLAN_PRO_ANNUAL_AMOUNT: '149',
		STRIPE_PLAN_PREMIUM_PRODUCT_ID: 'prod_premium_live',
		STRIPE_PLAN_PREMIUM_PRICE_MONTHLY_ID: 'price_premium_monthly_live',
		STRIPE_PLAN_PREMIUM_PRICE_ANNUAL_ID: 'price_premium_annual_live',
		STRIPE_PLAN_PREMIUM_ANNUAL_AMOUNT: '249',
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
				const target = plans.find((p) => String(p._id) === String(filter._id));
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
			price: 19.9,
			annualPrice: 149,
			stripeProductId: 'prod_pro_live',
			stripePriceId: 'price_pro_monthly_live',
			annualStripePriceId: 'price_pro_annual_live',
			currency: 'brl',
			interval: 'month',
			isActive: true,
		});

		const premiumDoc = plans.find((p) => p.name === 'Wealth');
		expect(premiumDoc).toMatchObject({
			stripeProductId: 'prod_premium_live',
			stripePriceId: 'price_premium_monthly_live',
			annualStripePriceId: 'price_premium_annual_live',
			annualPrice: 249,
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
			price: 19.9,
			stripeProductId: 'prod_pro_live',
			stripePriceId: 'price_pro_monthly_live',
			annualStripePriceId: 'price_pro_annual_live',
			annualPrice: 149,
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
		const legacy = report.legacy.find((l) => l.planId === 'legacy_with_users');
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

	it('vincula os preços pelo lookup_key do Stripe quando não há variável de ambiente', async () => {
		const stripe = {
			prices: {
				list: jest.fn(async ({ lookup_keys }: { lookup_keys: string[] }) => ({
					data: lookup_keys.map((key) => ({
						id: `price_${key}`,
						lookup_key: key,
						product: `prod_${key.split('_')[1]}`,
						unit_amount: key.endsWith('annual') ? 14900 : 1490,
					})),
				})),
			},
		};
		const withStripe = new PlanSyncService(
			subscriptionModel,
			userSubscriptionModel,
			stripe as any
		);

		await withStripe.syncCanonicalPlans({ env: {} });

		expect(plans.find((p) => p.name === 'Pro')).toMatchObject({
			accessLevel: 10,
			stripeProductId: 'prod_pro',
			stripePriceId: 'price_trackerr_pro_monthly',
			annualStripePriceId: 'price_trackerr_pro_annual',
			annualPrice: 149,
		});
	});

	describe('vínculo pelo nome do produto no Stripe (sem env nem lookup_key)', () => {
		const recurring = (
			id: string,
			product: string,
			interval: 'month' | 'year',
			cents: number,
			currency = 'brl'
		) => ({
			id,
			product,
			currency,
			unit_amount: cents,
			recurring: { interval, interval_count: 1 },
		});

		const stripeWith = (
			products: Array<{ id: string; name: string }>,
			pricesByProduct: Record<string, any[]>
		) => ({
			prices: {
				list: jest.fn(async (params: any) =>
					params.lookup_keys
						? { data: [] }
						: { data: pricesByProduct[params.product] ?? [] }
				),
			},
			products: { list: jest.fn(async () => ({ data: products })) },
		});

		const liveCatalog = () =>
			stripeWith(
				[
					{ id: 'prod_pro', name: 'Pro' },
					{ id: 'prod_wealth', name: 'Wealth' },
				],
				{
					prod_pro: [
						recurring('price_pro_m', 'prod_pro', 'month', 1990),
						recurring('price_pro_y', 'prod_pro', 'year', 17990),
					],
					prod_wealth: [
						recurring('price_w_m', 'prod_wealth', 'month', 3990),
						recurring('price_w_y', 'prod_wealth', 'year', 32990),
					],
				}
			);

		it('vincula IDs e grava os valores cobrados pelo Stripe', async () => {
			const withStripe = new PlanSyncService(
				subscriptionModel,
				userSubscriptionModel,
				liveCatalog() as any
			);

			const report = await withStripe.syncCanonicalPlans({ env: {} });

			expect(plans.find((p) => p.name === 'Pro')).toMatchObject({
				stripeProductId: 'prod_pro',
				stripePriceId: 'price_pro_m',
				annualStripePriceId: 'price_pro_y',
				price: 19.9,
				annualPrice: 179.9,
			});
			expect(plans.find((p) => p.name === 'Wealth')).toMatchObject({
				stripeProductId: 'prod_wealth',
				stripePriceId: 'price_w_m',
				annualStripePriceId: 'price_w_y',
				price: 39.9,
				annualPrice: 329.9,
			});
			expect(report.todos).toEqual([]);
		});

		it('preço do Stripe vence o valor editado pelo admin no painel', async () => {
			plans.push({
				_id: 'plan_pro_admin',
				name: 'Pro',
				price: 14.9,
				annualPrice: 149,
				description: 'Texto do admin',
				currency: 'brl',
				interval: 'month',
				intervalCount: 1,
				accessLevel: 10,
				isActive: true,
				catalogManaged: false,
			});
			const withStripe = new PlanSyncService(
				subscriptionModel,
				userSubscriptionModel,
				liveCatalog() as any
			);

			await withStripe.syncCanonicalPlans({ env: {} });

			expect(plans.find((p) => p._id === 'plan_pro_admin')).toMatchObject({
				price: 19.9,
				annualPrice: 179.9,
				stripePriceId: 'price_pro_m',
				description: 'Texto do admin',
			});
		});

		it('dois produtos com o mesmo nome: não vincula e avisa', async () => {
			const withStripe = new PlanSyncService(
				subscriptionModel,
				userSubscriptionModel,
				stripeWith(
					[
						{ id: 'prod_a', name: 'Pro' },
						{ id: 'prod_b', name: 'pro' },
					],
					{}
				) as any
			);

			const report = await withStripe.syncCanonicalPlans({ env: {} });

			const pro = report.plans.find((p) => p.slug === 'pro')!;
			expect(pro.warnings.join(' ')).toContain('2 produtos ativos');
			expect(
				plans.find((p) => p.name === 'Pro')?.stripePriceId
			).toBeUndefined();
		});

		it('dois preços mensais no produto: não vincula o mensal, mantém o anual', async () => {
			const withStripe = new PlanSyncService(
				subscriptionModel,
				userSubscriptionModel,
				stripeWith([{ id: 'prod_pro', name: 'Pro' }], {
					prod_pro: [
						recurring('price_m1', 'prod_pro', 'month', 1990),
						recurring('price_m2', 'prod_pro', 'month', 2990),
						recurring('price_y', 'prod_pro', 'year', 17990),
					],
				}) as any
			);

			const report = await withStripe.syncCanonicalPlans({ env: {} });

			const pro = report.plans.find((p) => p.slug === 'pro')!;
			expect(pro.warnings.join(' ')).toContain('2 preços mensais');
			expect(plans.find((p) => p.name === 'Pro')).toMatchObject({
				annualStripePriceId: 'price_y',
				annualPrice: 179.9,
			});
			expect(
				plans.find((p) => p.name === 'Pro')?.stripePriceId
			).toBeUndefined();
		});

		it('ignora preço em outra moeda', async () => {
			const withStripe = new PlanSyncService(
				subscriptionModel,
				userSubscriptionModel,
				stripeWith([{ id: 'prod_pro', name: 'Pro' }], {
					prod_pro: [recurring('price_usd', 'prod_pro', 'month', 500, 'usd')],
				}) as any
			);

			await withStripe.syncCanonicalPlans({ env: {} });

			expect(
				plans.find((p) => p.name === 'Pro')?.stripePriceId
			).toBeUndefined();
		});

		it('falha na busca por produto vira aviso, não derruba o sync', async () => {
			const stripe = liveCatalog();
			stripe.products.list.mockRejectedValue(new Error('timeout'));
			const withStripe = new PlanSyncService(
				subscriptionModel,
				userSubscriptionModel,
				stripe as any
			);

			const report = await withStripe.syncCanonicalPlans({ env: {} });

			const pro = report.plans.find((p) => p.slug === 'pro')!;
			expect(pro.warnings.join(' ')).toContain('falhou (timeout)');
		});
	});

	it('não desativa planos do admin quando deactivateLegacy é false', async () => {
		plans.push({ _id: 'custom', name: 'Plano Ouro', isActive: true });

		const report = await service.syncCanonicalPlans({
			env,
			deactivateLegacy: false,
		});

		expect(report.legacy).toEqual([]);
		expect(plans.find((p) => p._id === 'custom')?.isActive).toBe(true);
	});

	// A Stripe sinaliza ID de outro modo com `code: 'resource_missing'` — é
	// esse código, e não um erro qualquer, que autoriza descartar o vínculo.
	const resourceMissing = (message: string) =>
		Object.assign(new Error(message), { code: 'resource_missing' });

	it('limpa preço gravado que não existe na conta Stripe da chave atual', async () => {
		plans.push({
			_id: 'plan_pro',
			name: 'Pro',
			stripePriceId: 'price_de_outro_modo',
			isActive: true,
		});
		const stripe = {
			prices: {
				retrieve: jest.fn(async () => {
					throw resourceMissing('No such price');
				}),
				list: jest.fn(async () => ({ data: [] })),
			},
		};
		const withStripe = new PlanSyncService(
			subscriptionModel,
			userSubscriptionModel,
			stripe as any
		);

		const report = await withStripe.syncCanonicalPlans({ env: {} });

		const pro = report.plans.find((p) => p.slug === 'pro')!;
		expect(pro.changes).toContainEqual({
			field: 'stripePriceId',
			from: 'price_de_outro_modo',
			to: undefined,
		});
	});

	it('limpa produto gravado que não existe na conta Stripe da chave atual', async () => {
		// TRA-187: o produto de teste sobrevivia ao deploy e travava a edição
		// do plano no painel admin com "No such product".
		plans.push({
			_id: 'plan_pro',
			name: 'Pro',
			stripeProductId: 'prod_de_outro_modo',
			isActive: true,
		});
		const stripe = {
			prices: { list: jest.fn(async () => ({ data: [] })) },
			products: {
				retrieve: jest.fn(async () => {
					throw resourceMissing('No such product');
				}),
			},
		};
		const withStripe = new PlanSyncService(
			subscriptionModel,
			userSubscriptionModel,
			stripe as any
		);

		const report = await withStripe.syncCanonicalPlans({ env: {} });

		const pro = report.plans.find((p) => p.slug === 'pro')!;
		expect(pro.changes).toContainEqual({
			field: 'stripeProductId',
			from: 'prod_de_outro_modo',
			to: undefined,
		});
	});

	it('descarta produto de outro modo vindo da variável de ambiente', async () => {
		const stripe = {
			prices: { list: jest.fn(async () => ({ data: [] })) },
			products: {
				retrieve: jest.fn(async () => {
					throw resourceMissing('No such product');
				}),
			},
		};
		const withStripe = new PlanSyncService(
			subscriptionModel,
			userSubscriptionModel,
			stripe as any
		);

		await withStripe.syncCanonicalPlans({
			env: { STRIPE_PLAN_PRO_PRODUCT_ID: 'prod_de_outro_modo' },
		});

		expect(
			plans.find((p) => p.name === 'Pro')?.stripeProductId
		).toBeUndefined();
	});

	it('mantém os IDs gravados quando o Stripe falha por motivo transitório', async () => {
		// Instabilidade de rede no boot não pode apagar vínculo válido de
		// produção: só a ausência confirmada descarta.
		plans.push({
			_id: 'plan_pro',
			name: 'Pro',
			stripeProductId: 'prod_pro_valido',
			stripePriceId: 'price_pro_valido',
			isActive: true,
		});
		const stripe = {
			prices: {
				retrieve: jest.fn(async () => {
					throw new Error('Connection timeout');
				}),
				list: jest.fn(async () => ({ data: [] })),
			},
			products: {
				retrieve: jest.fn(async () => {
					throw new Error('Connection timeout');
				}),
			},
		};
		const withStripe = new PlanSyncService(
			subscriptionModel,
			userSubscriptionModel,
			stripe as any
		);

		const report = await withStripe.syncCanonicalPlans({ env: {} });

		const pro = report.plans.find((p) => p.slug === 'pro')!;
		const cleared = pro.changes.filter((c) => c.to === undefined);
		expect(cleared).toEqual([]);
	});

	// TRA-188: editar um plano pelo painel admin marca catalogManaged: false.
	// A partir daí o seed vira backfill puro — nunca mais reverte o que o
	// admin definiu, só preenche campo ainda vazio.
	describe('plano gerenciado pelo admin (catalogManaged: false)', () => {
		it('não sobrescreve nome, preço nem features que o admin já definiu', async () => {
			plans.push({
				_id: 'plan_pro_admin',
				name: 'Pro',
				price: 19.9,
				currency: 'brl',
				interval: 'month',
				intervalCount: 1,
				accessLevel: 10,
				isActive: true,
				isFeatured: false,
				isComingSoon: false,
				features: ['Feature editada pelo admin'],
				catalogManaged: false,
			});

			const report = await service.syncCanonicalPlans({ env });
			const pro = report.plans.find((p) => p.slug === 'pro')!;

			const proDoc = plans.find((p) => p._id === 'plan_pro_admin');
			expect(proDoc.price).toBe(19.9);
			expect(proDoc.features).toEqual(['Feature editada pelo admin']);
			expect(pro.changes.map((c) => c.field)).not.toContain('price');
			expect(pro.changes.map((c) => c.field)).not.toContain('features');
		});

		it('ainda assim preenche campo de conteúdo que está vazio', async () => {
			plans.push({
				_id: 'plan_pro_admin',
				name: 'Pro',
				price: 19.9,
				currency: 'brl',
				interval: 'month',
				intervalCount: 1,
				isActive: true,
				// accessLevel nunca foi definido — o admin editou outros campos,
				// não este.
				catalogManaged: false,
			});

			const report = await service.syncCanonicalPlans({ env });
			const pro = report.plans.find((p) => p.slug === 'pro')!;

			expect(pro.changes).toContainEqual({
				field: 'accessLevel',
				from: undefined,
				to: 10,
			});
			expect(plans.find((p) => p._id === 'plan_pro_admin').accessLevel).toBe(
				10
			);
		});

		it('continua reconciliando o vínculo Stripe mesmo com o conteúdo preservado', async () => {
			plans.push({
				_id: 'plan_pro_admin',
				name: 'Pro',
				price: 19.9,
				currency: 'brl',
				interval: 'month',
				intervalCount: 1,
				isActive: true,
				stripeProductId: 'prod_outdated',
				catalogManaged: false,
			});

			const report = await service.syncCanonicalPlans({ env });
			const pro = report.plans.find((p) => p.slug === 'pro')!;

			expect(pro.changes).toContainEqual({
				field: 'stripeProductId',
				from: 'prod_outdated',
				to: 'prod_pro_live',
			});
			expect(
				plans.find((p) => p._id === 'plan_pro_admin').stripeProductId
			).toBe('prod_pro_live');
		});

		it('não reativa um plano que o admin desativou (deactivatePlan) antes de qualquer outra edição', async () => {
			// Plano ainda nunca editado pelo painel (catalogManaged: false só é
			// gravado quando o admin desativa/edita) e isActive:false — o
			// target do canonical inclui isActive:true incondicionalmente;
			// sem o backfill-only isto reativaria o plano no boot seguinte.
			plans.push({
				_id: 'plan_pro_deactivated',
				name: 'Pro',
				price: 14.9,
				currency: 'brl',
				interval: 'month',
				intervalCount: 1,
				accessLevel: 10,
				isActive: false,
				catalogManaged: false,
			});

			await service.syncCanonicalPlans({ env });

			expect(plans.find((p) => p._id === 'plan_pro_deactivated').isActive).toBe(
				false
			);
		});

		it('plano legado sem a flag continua sendo sincronizado por completo (compatibilidade)', async () => {
			plans.push({
				_id: 'plan_pro_legacy',
				name: 'Pro',
				price: 199,
				currency: 'brl',
				interval: 'month',
				intervalCount: 1,
				isActive: true,
				// Documento anterior à TRA-188 — nunca teve catalogManaged
				// gravado. Trata como o padrão do schema (true).
			});

			await service.syncCanonicalPlans({ env });

			expect(plans.find((p) => p._id === 'plan_pro_legacy').price).toBe(19.9);
		});
	});
});
