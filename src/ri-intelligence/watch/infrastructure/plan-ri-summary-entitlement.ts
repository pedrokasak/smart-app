import { Inject, Injectable, Logger } from '@nestjs/common';
import { RiSummaryEntitlement } from 'src/ri-intelligence/watch/application/ports/ri-summary-entitlement.port';
import {
	planHasCapability,
	USER_PLAN_RESOLVER,
	UserPlanResolverPort,
} from 'src/subscription/application/user-plan.types';

/** Resolucoes de plano em paralelo: limita a carga no banco por aviso. */
const BATCH_SIZE = 20;

/**
 * `ri.ai_summary` pelo plano de cada usuario (TRA-261), com a mesma regra do
 * gate HTTP e do chat (`planHasCapability`). Falha ao resolver um usuario
 * nega so a ele: e feature paga, e o aviso sai do mesmo jeito, sem os
 * destaques.
 */
@Injectable()
export class PlanRiSummaryEntitlement implements RiSummaryEntitlement {
	private readonly logger = new Logger(PlanRiSummaryEntitlement.name);

	constructor(
		@Inject(USER_PLAN_RESOLVER)
		private readonly plans: UserPlanResolverPort
	) {}

	async usersWithAiSummary(userIds: string[]): Promise<Set<string>> {
		const allowed = new Set<string>();
		const unique = [...new Set(userIds)];
		for (let start = 0; start < unique.length; start += BATCH_SIZE) {
			const batch = unique.slice(start, start + BATCH_SIZE);
			const results = await Promise.all(
				batch.map(
					async (userId) => [userId, await this.allows(userId)] as const
				)
			);
			for (const [userId, ok] of results) if (ok) allowed.add(userId);
		}
		return allowed;
	}

	private async allows(userId: string): Promise<boolean> {
		try {
			const access = await this.plans.resolveWithCapabilities(userId);
			return planHasCapability(
				access.capabilities,
				'ri.ai_summary',
				access.tier,
				access.capabilitiesKnown
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.warn(
				`Vigia de RI: plano do usuario ${userId} indisponivel (${message}); aviso sem destaques`
			);
			return false;
		}
	}
}
