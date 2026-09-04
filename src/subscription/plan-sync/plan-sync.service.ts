import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subscription, UserSubscription } from 'src/subscription/schema';
import {
	CANONICAL_PLANS,
	CanonicalPlan,
	envKeysForSlug,
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
export class PlanSyncService {
	private readonly logger = new Logger(PlanSyncService.name);

	constructor(
		@InjectModel('Subscription')
		private readonly subscriptionModel: Model<Subscription>,
		@InjectModel('UserSubscription')
		private readonly userSubscriptionModel: Model<UserSubscription>
	) {}

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

		const legacyReports = await this.deactivateLegacyPlans({
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
		const envProductId = ctx.env[envKeys.productId]?.trim() || undefined;
		const envMonthlyPriceId =
			ctx.env[envKeys.monthlyPriceId]?.trim() || undefined;
		const envAnnualPriceId =
			ctx.env[envKeys.annualPriceId]?.trim() || undefined;
		const envAnnualAmountRaw = ctx.env[envKeys.annualAmount]?.trim();
		const envAnnualAmount = envAnnualAmountRaw
			? Number(envAnnualAmountRaw)
			: undefined;

		const todos: string[] = [];
		const warnings: string[] = [];

		if (
			canonical.kind === 'stripe_subscription' &&
			(!envProductId || !envMonthlyPriceId)
		) {
			todos.push(
				`Defina ${envKeys.productId} e ${envKeys.monthlyPriceId} — sem eles ` +
					`o plano fica sem vínculo mensal no Stripe. Crie via ` +
					`\`stripe products create --name "${canonical.name}"\` e ` +
					`\`stripe prices create --product <PROD> --unit-amount ${canonical.monthlyPrice * 100} --currency ${canonical.currency} --recurring[interval]=month\`.`
			);
		}
		if (canonical.kind === 'stripe_subscription' && !envAnnualPriceId) {
			todos.push(
				`Defina ${envKeys.annualPriceId} para expor o preço anual. Crie via ` +
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
			price: canonical.monthlyPrice,
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
		for (const [field, to] of Object.entries(target)) {
			const from = (existing as any)[field];
			if (!deepEqual(from, to)) {
				changes.push({ field, from, to });
				$set[field] = to;
			}
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
				{ $set }
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
			(p) => String(p.name || '').toLowerCase().trim() === canonicalName
		);
		if (byName) return { plan: byName, reason: 'slug' };

		const aliasSet = new Set(canonical.aliases.map((a) => a.toLowerCase()));
		aliasSet.add(canonical.slug.toLowerCase());
		const byAlias = existingPlans.find((p) =>
			aliasSet.has(String(p.name || '').toLowerCase().trim())
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
				reason: 'Não corresponde a nenhum slug canônico e não tem assinantes ativos.',
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
		return ak.every((k) =>
			deepEqual((a as any)[k], (b as any)[k])
		);
	}
	return false;
}
