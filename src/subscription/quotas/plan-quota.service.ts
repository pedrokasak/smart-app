import { Inject, Injectable } from '@nestjs/common';
import {
	ALL_PLAN_QUOTA_RESOURCES,
	PLAN_QUOTA_USAGE,
	PlanQuotaResource,
	PlanQuotaUsagePort,
	planQuotaExceeded,
	planQuotaLimit,
} from 'src/subscription/application/plan-quotas';
import {
	PlanAccess,
	USER_PLAN_RESOLVER,
	UserPlanResolverPort,
} from 'src/subscription/application/user-plan.types';

export interface QuotaUsage {
	resource: PlanQuotaResource;
	used: number;
	/** `null` = ilimitado. */
	limit: number | null;
}

@Injectable()
export class PlanQuotaService {
	constructor(
		@Inject(USER_PLAN_RESOLVER)
		private readonly planResolver: UserPlanResolverPort,
		@Inject(PLAN_QUOTA_USAGE)
		private readonly usage: PlanQuotaUsagePort
	) {}

	async limitFor(
		userId: string,
		resource: PlanQuotaResource
	): Promise<number | null> {
		return this.limitOf(
			await this.planResolver.resolveWithCapabilities(userId),
			resource
		);
	}

	private limitOf(access: PlanAccess, resource: PlanQuotaResource) {
		// Plano ilegível não é plano gratuito: barrar quem paga por uma falha
		// de consulta, com o limite do gratuito, seria negar indevidamente. Uma
		// cota não é barreira de segurança, então aqui falha aberto.
		if (access.degraded) return null;
		return planQuotaLimit(access.quotas, resource, access.tier);
	}

	/**
	 * Recusa quando adicionar `adding` itens passaria do limite. Para quem já
	 * passou (plano rebaixado, cota nova), só bloqueia criar: o que existe fica.
	 */
	async assertCanAdd(
		userId: string,
		resource: PlanQuotaResource,
		adding = 1
	): Promise<void> {
		const limit = await this.limitFor(userId, resource);
		if (limit === null) return;
		const used = await this.usage.count(userId, resource);
		if (used + adding > limit) throw planQuotaExceeded(resource, limit);
	}

	/**
	 * Confere antes (resposta rápida, sem efeito colateral) e confere de novo
	 * depois de gravar, desfazendo se estourou. Só a segunda fecha a corrida:
	 * duas requisições simultâneas contam o mesmo valor antes de qualquer uma
	 * gravar e as duas passariam (TRA-89).
	 */
	async createWithinQuota<T>(
		userId: string,
		resource: PlanQuotaResource,
		create: () => Promise<T>,
		undo: (created: T) => Promise<unknown>
	): Promise<T> {
		const limit = await this.limitFor(userId, resource);
		if (limit === null) return create();

		if ((await this.usage.count(userId, resource)) >= limit) {
			throw planQuotaExceeded(resource, limit);
		}
		const created = await create();
		if ((await this.usage.count(userId, resource)) > limit) {
			await undo(created);
			throw planQuotaExceeded(resource, limit);
		}
		return created;
	}

	async usageFor(userId: string): Promise<QuotaUsage[]> {
		const access = await this.planResolver.resolveWithCapabilities(userId);
		return Promise.all(
			ALL_PLAN_QUOTA_RESOURCES.map(async (resource) => ({
				resource,
				used: await this.usage.count(userId, resource),
				limit: this.limitOf(access, resource),
			}))
		);
	}
}
