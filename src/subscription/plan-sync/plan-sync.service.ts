import {
	Injectable,
	Logger,
	OnApplicationBootstrap,
	Optional,
} from '@nestjs/common';
import Stripe from 'stripe';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subscription, UserSubscription } from 'src/subscription/schema';
import { isStripeResourceMissing } from 'src/subscription/stripe.service';
import {
	CANONICAL_PLANS,
	CanonicalPlan,
	envKeysForSlug,
	lookupKeysForSlug,
} from './canonical-plans.config';

export interface PlanSyncFieldChange {
	field: string;
	from: unknown;
	to: unknown;
}

export interface PlanSyncEntry {
	slug: string;
	name: string;
	action: 'created' | 'updated' | 'unchanged' | 'skipped';
	matchedBy: 'slug' | 'alias' | 'productId' | 'none';
	changes: PlanSyncFieldChange[];
	warnings: string[];
	todos: string[];
	planId?: string;
}

export interface PlanSyncLegacyReport {
	planId: string;
	name: string;
	activeSubscribers: number;
	action: 'deactivated' | 'kept-active';
	reason: string;
}

export interface PlanSyncReport {
	dryRun: boolean;
	syncedAt: Date;
	plans: PlanSyncEntry[];
	legacy: PlanSyncLegacyReport[];
	todos: string[];
}

export interface PlanSyncOptions {
	dryRun?: boolean;
	/** Fonte de variáveis de ambiente. Injetável para facilitar testes. */
	env?: NodeJS.ProcessEnv;
	/**
	 * Desativa planos fora da lista canônica. O sync automático do boot
	 * desliga isto para não aposentar planos criados pelo admin.
	 */
	deactivateLegacy?: boolean;
}

interface StripeIds {
	productId?: string;
	monthlyPriceId?: string;
	annualPriceId?: string;
	/** `unit_amount` do preço mensal no Stripe, em BRL. */
	monthlyAmount?: number;
	annualAmount?: number;
	/** `annualAmount` veio do Stripe (não do override por env). */
	annualAmountFromStripe?: boolean;
	warnings: string[];
}

const STRIPE_CALL = { timeout: 10_000, maxNetworkRetries: 1 } as const;

const toBrl = (price?: Stripe.Price | null) =>
	price?.unit_amount != null ? price.unit_amount / 100 : undefined;

/**
 * Vínculos Stripe reconciliam sempre, mesmo em plano que o admin já editou
 * — um `stripeProductId` de outro modo trava o painel independente de quem
 * é dono do conteúdo. Todo o resto do `target` é conteúdo comercial e só
 * sobrescreve plano `catalogManaged: false` quando o campo está vazio.
 */
const STRIPE_LINK_FIELDS = new Set([
	'stripeProductId',
	'stripePriceId',
	'annualStripePriceId',
]);

function isEmptyContentValue(value: unknown): boolean {
	if (value === undefined || value === null) return true;
	if (Array.isArray(value)) return value.length === 0;
	return false;
}

/**
 * Serviço idempotente que reconcilia a coleção `subscriptions` do Mongo com
 * a definição canônica de planos (TRA-18).
 *
 * Substitui a migração que tradicionalmente rodaria em SQL. No Mongo,
 * "migração" vira um seed idempotente disparado via CLI ou em bootstrap.
 * Rodar duas vezes seguidas com o mesmo input não faz alteração alguma —
 * essa é a garantia principal.
 *
 * Nunca inventa `stripeProductId` / `stripePriceId` / `annualStripePriceId`:
 * se a env correspondente não estiver setada, o campo é preservado e um
 * TODO é anexado ao relatório para o operador humano criar o recurso no
 * Stripe e reexecutar o seed.
 */
@Injectable()
export class PlanSyncService implements OnApplicationBootstrap {
	private readonly logger = new Logger(PlanSyncService.name);

	constructor(
		@InjectModel('Subscription')
		private readonly subscriptionModel: Model<Subscription>,
		@InjectModel('UserSubscription')
		private readonly userSubscriptionModel: Model<UserSubscription>,
		@Optional() private readonly stripe?: Stripe
	) {}

	/**
	 * Cada deploy reconcilia os planos canônicos com o Stripe da própria
	 * chave (teste ou live), sem depender de script manual. Falha aqui não
	 * derruba a API: a vitrine só fica com o que já estava no banco.
	 */
	onApplicationBootstrap() {
		if (
			process.env.NODE_ENV === 'test' ||
			process.env.PLAN_SYNC_ON_BOOT === 'false'
		) {
			return;
		}
		// Sem await: o hook roda ANTES do app começar a escutar. Uma chamada
		// lenta ao Mongo ou ao Stripe aqui deixaria a API inteira fora do ar
		// enquanto não respondesse.
		void this.runBootstrapSync();
	}

	private async runBootstrapSync() {
		try {
			const report = await this.syncCanonicalPlans({ deactivateLegacy: false });
			for (const entry of report.plans) {
				this.logger.log(`[plan-sync] ${entry.slug}: ${entry.action}`);
			}
			for (const todo of report.todos) this.logger.warn(`[plan-sync] ${todo}`);
		} catch (error) {
			this.logger.error(`[plan-sync] falhou no boot: ${error?.message}`);
		}
	}

	/**
	 * IDs do Stripe por plano: variável de ambiente primeiro; sem ela, o
	 * preço com `lookup_key` `trackerr_<slug>_monthly`/`_annual` na conta da
	 * chave configurada. Assim os IDs de teste e live nunca se misturam.
	 */
	private async resolveStripeIds(
		canonical: CanonicalPlan,
		env: NodeJS.ProcessEnv
	): Promise<StripeIds> {
		const keys = envKeysForSlug(canonical.slug);
		const amountRaw = env[keys.annualAmount]?.trim();
		// A env var também precisa passar pela conta atual: um
		// `STRIPE_PLAN_<SLUG>_PRODUCT_ID` de teste no ambiente de produção
		// reintroduziria o ID inválido a cada boot.
		const envMonthly = await this.usablePrice(env[keys.monthlyPriceId]?.trim());
		const envAnnual = await this.usablePrice(env[keys.annualPriceId]?.trim());
		const ids: StripeIds = {
			productId: await this.keepProductIfUsable(env[keys.productId]?.trim()),
			monthlyPriceId: envMonthly?.id,
			annualPriceId: envAnnual?.id,
			monthlyAmount: envMonthly?.amount,
			annualAmount: amountRaw ? Number(amountRaw) : undefined,
			warnings: [],
		};
		if (ids.annualAmount === undefined && envAnnual?.amount !== undefined) {
			ids.annualAmount = envAnnual.amount;
			ids.annualAmountFromStripe = true;
		}
		const needsLookup =
			canonical.kind === 'stripe_subscription' &&
			(!ids.monthlyPriceId || !ids.annualPriceId);
		if (!needsLookup || !this.stripe) return ids;

		const lookup = lookupKeysForSlug(canonical.slug);
		const { data } = await this.stripe.prices.list(
			{
				lookup_keys: [lookup.monthly, lookup.annual],
				active: true,
				limit: 2,
			},
			// Stripe fora do ar não pode deixar o sync pendurado.
			STRIPE_CALL
		);
		let monthly = data.find((p) => p.lookup_key === lookup.monthly);
		let annual = data.find((p) => p.lookup_key === lookup.annual);
		if ((!ids.monthlyPriceId && !monthly) || (!ids.annualPriceId && !annual)) {
			const byName = await this.findPricesByProductName(canonical).catch(
				(error) => ({
					monthly: undefined,
					annual: undefined,
					warnings: [
						`Busca do produto "${canonical.name}" no Stripe falhou (${error?.message}).`,
					],
				})
			);
			ids.warnings.push(...byName.warnings);
			monthly ??= byName.monthly;
			annual ??= byName.annual;
		}
		this.applyResolvedPrices(ids, monthly, annual);
		return ids;
	}

	private applyResolvedPrices(
		ids: StripeIds,
		monthly?: Stripe.Price,
		annual?: Stripe.Price
	) {
		const productOf = (price?: Stripe.Price) =>
			typeof price?.product === 'string' ? price.product : price?.product?.id;

		if (!ids.monthlyPriceId && monthly) {
			ids.monthlyPriceId = monthly.id;
			ids.monthlyAmount = toBrl(monthly);
		}
		if (!ids.annualPriceId && annual) ids.annualPriceId = annual.id;
		ids.productId ??= productOf(monthly) ?? productOf(annual);
		if (ids.annualAmount === undefined && toBrl(annual) !== undefined) {
			ids.annualAmount = toBrl(annual);
			ids.annualAmountFromStripe = true;
		}
	}

	/**
	 * Último recurso, sem env nem `lookup_key`: o produto ativo com o mesmo
	 * nome do plano ("Pro", "Wealth") e o único preço recorrente mensal e
	 * anual na moeda do plano. Qualquer ambiguidade (dois produtos, dois
	 * preços mensais) não escolhe nada: vincular o preço errado cobraria o
	 * valor errado de alguém.
	 */
	private async findPricesByProductName(canonical: CanonicalPlan): Promise<{
		monthly?: Stripe.Price;
		annual?: Stripe.Price;
		warnings: string[];
	}> {
		const warnings: string[] = [];
		const wanted = canonical.name.trim().toLowerCase();
		const { data: products } = await this.stripe!.products.list(
			{ active: true, limit: 100 },
			STRIPE_CALL
		);
		const matches = products.filter(
			(product) => product.name?.trim().toLowerCase() === wanted
		);
		if (matches.length !== 1) {
			if (matches.length > 1) {
				warnings.push(
					`${matches.length} produtos ativos chamados "${canonical.name}" no Stripe; nenhum vinculado. Deixe um só ativo ou use lookup_key.`
				);
			}
			return { warnings };
		}

		const { data: prices } = await this.stripe!.prices.list(
			{ product: matches[0].id, active: true, type: 'recurring', limit: 100 },
			STRIPE_CALL
		);
		const pick = (interval: 'month' | 'year') => {
			const candidates = prices.filter(
				(price) =>
					price.currency === canonical.currency &&
					price.recurring?.interval === interval &&
					price.recurring?.interval_count === 1
			);
			if (candidates.length > 1) {
				warnings.push(
					`${candidates.length} preços ${interval === 'month' ? 'mensais' : 'anuais'} ativos em "${canonical.name}"; nenhum vinculado. Arquive os extras ou use lookup_key.`
				);
				return undefined;
			}
			return candidates[0];
		};
		return { monthly: pick('month'), annual: pick('year'), warnings };
	}

	/**
	 * Um ID de preço de outro modo (teste gravado no ambiente de produção,
	 * por exemplo) não existe para a chave atual: o checkout só descobriria
	 * isso na hora da compra, com "No such price". Aqui ele é descartado e o
	 * `lookup_key` assume.
	 */
	private async keepIfUsable(priceId?: string): Promise<string | undefined> {
		return (await this.usablePrice(priceId))?.id;
	}

	private async usablePrice(
		priceId?: string
	): Promise<{ id: string; amount?: number } | undefined> {
		if (!priceId) return undefined;
		if (!this.stripe) return { id: priceId };
		try {
			const price = await this.stripe.prices.retrieve(priceId, STRIPE_CALL);
			return price.active ? { id: price.id, amount: toBrl(price) } : undefined;
		} catch (error) {
			if (!isStripeResourceMissing(error)) {
				this.logger.warn(
					`[plan-sync] não deu para validar o preço ${priceId} (${error?.message}); mantido.`
				);
				return { id: priceId };
			}
			this.logger.warn(
				`[plan-sync] preço ${priceId} não existe nesta conta Stripe; usando o lookup_key.`
			);
			return undefined;
		}
	}

	/**
	 * Mesmo problema do preço, com consequência diferente: produto de outro
	 * modo faz o `products.update` do painel admin responder "No such
	 * product" e derruba a edição inteira do plano.
	 *
	 * Diferente do preço, `active: false` aqui é estado legítimo —
	 * `deactivatePlan` desativa o produto junto com o plano — então só a
	 * ausência na conta descarta o vínculo.
	 */
	private async keepProductIfUsable(
		productId?: string
	): Promise<string | undefined> {
		if (!productId || !this.stripe) return productId;
		try {
			await this.stripe.products.retrieve(productId, {
				timeout: 10_000,
				maxNetworkRetries: 1,
			});
			return productId;
		} catch (error) {
			if (!isStripeResourceMissing(error)) {
				this.logger.warn(
					`[plan-sync] não deu para validar o produto ${productId} (${error?.message}); mantido.`
				);
				return productId;
			}
			this.logger.warn(
				`[plan-sync] produto ${productId} não existe nesta conta Stripe; vínculo descartado.`
			);
			return undefined;
		}
	}

	async syncCanonicalPlans(
		options: PlanSyncOptions = {}
	): Promise<PlanSyncReport> {
		const env = options.env ?? process.env;
		const dryRun = options.dryRun ?? false;

		const existingPlans = await this.subscriptionModel.find().lean();
		const matchedIds = new Set<string>();
		const entries: PlanSyncEntry[] = [];
		const globalTodos: string[] = [];

		for (const canonical of CANONICAL_PLANS) {
			const entry = await this.upsertCanonical(canonical, {
				existingPlans,
				matchedIds,
				env,
				dryRun,
			});
			entries.push(entry);
			globalTodos.push(...entry.todos.map((t) => `[${entry.slug}] ${t}`));
		}

		const legacyReports =
			options.deactivateLegacy === false
				? []
				: await this.deactivateLegacyPlans({
						existingPlans,
						matchedIds,
						dryRun,
					});

		return {
			dryRun,
			syncedAt: new Date(),
			plans: entries,
			legacy: legacyReports,
			todos: globalTodos,
		};
	}

	private async upsertCanonical(
		canonical: CanonicalPlan,
		ctx: {
			existingPlans: any[];
			matchedIds: Set<string>;
			env: NodeJS.ProcessEnv;
			dryRun: boolean;
		}
	): Promise<PlanSyncEntry> {
		const envKeys = envKeysForSlug(canonical.slug);
		const stripeIds = await this.resolveStripeIds(canonical, ctx.env);
		const envProductId = stripeIds.productId;
		const envMonthlyPriceId = stripeIds.monthlyPriceId;
		const envAnnualPriceId = stripeIds.annualPriceId;
		const envAnnualAmountRaw = ctx.env[envKeys.annualAmount]?.trim();
		const envAnnualAmount = stripeIds.annualAmount;

		const todos: string[] = [];
		const warnings: string[] = [...stripeIds.warnings];

		if (
			canonical.kind === 'stripe_subscription' &&
			(!envProductId || !envMonthlyPriceId)
		) {
			todos.push(
				`Sem preço mensal no Stripe para "${canonical.name}": crie um produto ativo com esse nome ` +
					`e um preço recorrente mensal, ou defina ${envKeys.productId} e ${envKeys.monthlyPriceId}. Crie via ` +
					`\`stripe products create --name "${canonical.name}"\` e ` +
					`\`stripe prices create --product <PROD> --unit-amount ${canonical.monthlyPrice * 100} --currency ${canonical.currency} --recurring[interval]=month\`.`
			);
		}
		if (canonical.kind === 'stripe_subscription' && !envAnnualPriceId) {
			todos.push(
				`Sem preço anual no Stripe para "${canonical.name}": adicione um preço recorrente anual ao produto ou defina ${envKeys.annualPriceId}. Crie via ` +
					`\`stripe prices create --product <PROD> --unit-amount <AMOUNT_CENTS> --currency ${canonical.currency} --recurring[interval]=year\`.`
			);
		}
		if (envAnnualAmountRaw && Number.isNaN(envAnnualAmount)) {
			warnings.push(
				`${envKeys.annualAmount}="${envAnnualAmountRaw}" não é numérico; ignorado.`
			);
		}

		const match = this.matchExisting(canonical, ctx.existingPlans, {
			productId: envProductId,
		});
		const existing = match?.plan;
		const matchedBy: PlanSyncEntry['matchedBy'] = match?.reason ?? 'none';

		const target: Record<string, unknown> = {
			name: canonical.name,
			description: canonical.description,
			price: stripeIds.monthlyAmount ?? canonical.monthlyPrice,
			accessLevel: canonical.accessLevel,
			currency: canonical.currency,
			interval: canonical.interval,
			intervalCount: canonical.intervalCount,
			isFeatured: canonical.isFeatured,
			isComingSoon: canonical.isComingSoon,
			isActive: true,
			features: canonical.features,
			maxUsers: canonical.maxUsers,
		};

		if (envProductId) target.stripeProductId = envProductId;
		if (envMonthlyPriceId) target.stripePriceId = envMonthlyPriceId;
		if (envAnnualPriceId) target.annualStripePriceId = envAnnualPriceId;
		if (envAnnualAmount !== undefined && !Number.isNaN(envAnnualAmount)) {
			target.annualPrice = envAnnualAmount;
		} else if (canonical.annualPrice !== undefined) {
			target.annualPrice = canonical.annualPrice;
		}

		if (!existing) {
			const changes = Object.entries(target).map(([field, to]) => ({
				field,
				from: undefined,
				to,
			}));
			let planId: string | undefined;
			if (!ctx.dryRun) {
				const created = await this.subscriptionModel.create({
					...target,
					createdAt: new Date(),
					updatedAt: new Date(),
				});
				planId = String(created._id);
				ctx.matchedIds.add(planId);
			}
			return {
				slug: canonical.slug,
				name: canonical.name,
				action: ctx.dryRun ? 'skipped' : 'created',
				matchedBy: 'none',
				changes,
				warnings,
				todos,
				planId,
			};
		}

		ctx.matchedIds.add(String(existing._id));
		const changes: PlanSyncFieldChange[] = [];
		const $set: Record<string, unknown> = {};
		// ID gravado que não existe mais nesta conta (ex.: ID de teste num
		// deploy com chave live) sai do plano: mantê-lo só adiaria o erro para
		// o checkout do cliente ou para a próxima edição no painel admin.
		const $unset: Record<string, ''> = {};
		const staleChecks = [
			{
				field: 'stripePriceId',
				validate: (id: string) => this.keepIfUsable(id),
			},
			{
				field: 'annualStripePriceId',
				validate: (id: string) => this.keepIfUsable(id),
			},
			{
				field: 'stripeProductId',
				validate: (id: string) => this.keepProductIfUsable(id),
			},
		] as const;
		for (const { field, validate } of staleChecks) {
			const stored = (existing as any)[field];
			if (!stored || target[field]) continue;
			if (await validate(stored)) continue;
			changes.push({ field, from: stored, to: undefined });
			$unset[field] = '';
		}
		// `catalogManaged: false` marca plano que um admin já editou pelo
		// painel (TRA-188): a partir daí o seed vira backfill — só preenche
		// campo de conteúdo ainda vazio, nunca sobrescreve valor definido.
		const adminOwned = (existing as any).catalogManaged === false;
		let preservedByAdmin = 0;
		// Valor lido do Stripe é o que o cliente paga: vence até edição do
		// admin, senão a vitrine mostra um preço e o checkout cobra outro.
		const stripeOwned = new Set(STRIPE_LINK_FIELDS);
		if (stripeIds.monthlyAmount !== undefined) stripeOwned.add('price');
		if (stripeIds.annualAmountFromStripe) stripeOwned.add('annualPrice');
		for (const [field, to] of Object.entries(target)) {
			const from = (existing as any)[field];
			const isContentField = !stripeOwned.has(field);
			if (adminOwned && isContentField && !isEmptyContentValue(from)) {
				if (!deepEqual(from, to)) preservedByAdmin += 1;
				continue;
			}
			if (!deepEqual(from, to)) {
				changes.push({ field, from, to });
				$set[field] = to;
			}
		}
		if (preservedByAdmin > 0) {
			warnings.push(
				`${preservedByAdmin} campo(s) preservado(s) por já terem sido definidos pelo admin no painel.`
			);
		}

		if (!changes.length) {
			return {
				slug: canonical.slug,
				name: canonical.name,
				action: 'unchanged',
				matchedBy,
				changes,
				warnings,
				todos,
				planId: String(existing._id),
			};
		}

		if (!ctx.dryRun) {
			$set.updatedAt = new Date();
			await this.subscriptionModel.updateOne(
				{ _id: existing._id },
				Object.keys($unset).length ? { $set, $unset } : { $set }
			);
		}

		return {
			slug: canonical.slug,
			name: canonical.name,
			action: 'updated',
			matchedBy,
			changes,
			warnings,
			todos,
			planId: String(existing._id),
		};
	}

	private matchExisting(
		canonical: CanonicalPlan,
		existingPlans: any[],
		hints: { productId?: string }
	): { plan: any; reason: PlanSyncEntry['matchedBy'] } | undefined {
		if (hints.productId) {
			const byProduct = existingPlans.find(
				(p) => p.stripeProductId && p.stripeProductId === hints.productId
			);
			if (byProduct) return { plan: byProduct, reason: 'productId' };
		}
		const canonicalName = canonical.name.toLowerCase().trim();
		const byName = existingPlans.find(
			(p) =>
				String(p.name || '')
					.toLowerCase()
					.trim() === canonicalName
		);
		if (byName) return { plan: byName, reason: 'slug' };

		const aliasSet = new Set(canonical.aliases.map((a) => a.toLowerCase()));
		aliasSet.add(canonical.slug.toLowerCase());
		const byAlias = existingPlans.find((p) =>
			aliasSet.has(
				String(p.name || '')
					.toLowerCase()
					.trim()
			)
		);
		if (byAlias) return { plan: byAlias, reason: 'alias' };
		return undefined;
	}

	private async deactivateLegacyPlans(ctx: {
		existingPlans: any[];
		matchedIds: Set<string>;
		dryRun: boolean;
	}): Promise<PlanSyncLegacyReport[]> {
		const reports: PlanSyncLegacyReport[] = [];
		const legacy = ctx.existingPlans.filter(
			(p) => !ctx.matchedIds.has(String(p._id))
		);
		if (!legacy.length) return reports;

		const legacyIds = legacy.map((p) => p._id);
		const counts = await this.userSubscriptionModel.aggregate([
			{
				$match: {
					plan: { $in: legacyIds },
					status: { $in: ['active', 'trialing'] },
				},
			},
			{ $group: { _id: '$plan', count: { $sum: 1 } } },
		]);
		const countsById = new Map(
			counts.map((c: any) => [String(c._id), Number(c.count)])
		);

		for (const plan of legacy) {
			const activeSubscribers = countsById.get(String(plan._id)) || 0;
			if (activeSubscribers > 0) {
				reports.push({
					planId: String(plan._id),
					name: plan.name,
					activeSubscribers,
					action: 'kept-active',
					reason:
						'Possui assinantes ativos/trialing. Migrar clientes manualmente antes de desativar.',
				});
				continue;
			}
			if (plan.isActive !== false && !ctx.dryRun) {
				await this.subscriptionModel.updateOne(
					{ _id: plan._id },
					{ $set: { isActive: false, updatedAt: new Date() } }
				);
			}
			reports.push({
				planId: String(plan._id),
				name: plan.name,
				activeSubscribers: 0,
				action: 'deactivated',
				reason:
					'Não corresponde a nenhum slug canônico e não tem assinantes ativos.',
			});
		}
		return reports;
	}
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === undefined || b === undefined) return a === b;
	if (a === null || b === null) return a === b;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((v, i) => deepEqual(v, b[i]));
	}
	if (typeof a === 'object' && typeof b === 'object') {
		const ak = Object.keys(a as object);
		const bk = Object.keys(b as object);
		if (ak.length !== bk.length) return false;
		return ak.every((k) => deepEqual((a as any)[k], (b as any)[k]));
	}
	return false;
}
