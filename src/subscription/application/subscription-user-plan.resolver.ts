import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionService } from 'src/subscription/subscription.service';
import {
	FREE_ACCESS_LEVEL,
	PREMIUM_ACCESS_LEVEL,
	PRO_ACCESS_LEVEL,
	UserPlanResolverPort,
	UserPlanTier,
} from 'src/subscription/application/user-plan.types';

/**
 * Resolve o nivel de acesso do usuario a partir da ASSINATURA (TRA-79).
 *
 * Principio 4.4 do CLAUDE.md: o Stripe e a fonte de verdade comercial, com
 * o banco local como espelho. `UserSubscription` e esse espelho — carrega
 * `stripeSubscriptionId` e o `status` que o webhook do Stripe atualiza.
 * Derivar plano de qualquer outro lugar (como o campo `plan` dentro de um
 * objeto de carteira, que era o que o orquestrador fazia) e derivar de um
 * dado que ninguem garante estar sincronizado com o que o cliente pagou.
 *
 * `findCurrentSubscriptionByUser` ja filtra por status `active`/`trialing`,
 * entao assinatura vencida ou cancelada nao chega aqui e o usuario cai em
 * `FREE_ACCESS_LEVEL` naturalmente.
 */
@Injectable()
export class SubscriptionUserPlanResolver implements UserPlanResolverPort {
	private readonly logger = new Logger(SubscriptionUserPlanResolver.name);

	constructor(private readonly subscriptionService: SubscriptionService) {}

	async resolve(userId: string): Promise<UserPlanTier> {
		if (!userId) return FREE_ACCESS_LEVEL;

		try {
			const subscription =
				await this.subscriptionService.findCurrentSubscriptionByUser(userId);
			if (!subscription) return FREE_ACCESS_LEVEL;

			const plan = (
				subscription as { plan?: { name?: string; accessLevel?: number } }
			)?.plan;
			// O nivel gravado no plano manda; o nome so vale de fallback pra
			// plano antigo criado antes do campo `accessLevel` existir.
			return typeof plan?.accessLevel === 'number'
				? plan.accessLevel
				: SubscriptionUserPlanResolver.tierFromPlanName(plan?.name);
		} catch (error) {
			// Falha na consulta nao pode virar acesso liberado por acidente.
			this.logger.warn(
				`Falha ao resolver plano do usuário ${userId}: ${error?.message}. Assumindo acesso gratuito.`
			);
			return FREE_ACCESS_LEVEL;
		}
	}

	/**
	 * Fallback legado: deriva um nivel a partir do NOME do plano (texto
	 * voltado ao usuario, ex. "Plano Destaque"), pra planos criados antes do
	 * campo `accessLevel` existir e que ainda nao passaram por um sync.
	 *
	 * Casa por substring de proposito: o nome e editavel no admin e no
	 * Stripe, e exigir igualdade exata quebraria o gate silenciosamente na
	 * primeira vez que alguem renomeasse "Premium" pra "Plano Premium". A
	 * ordem importa — "global"/"investor"/"enterprise" e checado antes de
	 * "premium" porque um nome pode conter os dois.
	 */
	static tierFromPlanName(rawName: string | undefined | null): UserPlanTier {
		const name = String(rawName || '')
			.toLowerCase()
			.trim();
		if (!name) return FREE_ACCESS_LEVEL;

		if (
			name.includes('enterprise') ||
			name.includes('global') ||
			name.includes('investor')
		) {
			return PREMIUM_ACCESS_LEVEL + 10;
		}
		if (name.includes('premium') || name.includes('wealth')) {
			return PREMIUM_ACCESS_LEVEL;
		}
		if (name.includes('pro')) return PRO_ACCESS_LEVEL;
		return FREE_ACCESS_LEVEL;
	}
}
