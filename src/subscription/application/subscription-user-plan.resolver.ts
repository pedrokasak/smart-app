import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionService } from 'src/subscription/subscription.service';
import {
	UserPlanResolverPort,
	UserPlanTier,
} from 'src/subscription/application/user-plan.types';

/**
 * Resolve o plano do usuario a partir da ASSINATURA (TRA-79).
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
 * `free` naturalmente.
 */
@Injectable()
export class SubscriptionUserPlanResolver implements UserPlanResolverPort {
	private readonly logger = new Logger(SubscriptionUserPlanResolver.name);

	constructor(private readonly subscriptionService: SubscriptionService) {}

	async resolve(userId: string): Promise<UserPlanTier> {
		if (!userId) return 'free';

		try {
			const subscription =
				await this.subscriptionService.findCurrentSubscriptionByUser(userId);
			if (!subscription) return 'free';

			const plan = (subscription as { plan?: { name?: string } })?.plan;
			return SubscriptionUserPlanResolver.tierFromPlanName(plan?.name);
		} catch (error) {
			// Falha na consulta nao pode virar acesso liberado por acidente.
			this.logger.warn(
				`Falha ao resolver plano do usuário ${userId}: ${error?.message}. Assumindo 'free'.`
			);
			return 'free';
		}
	}

	/**
	 * Mapeia o nome do plano (texto voltado ao usuario, ex. "Plano Destaque")
	 * pro nivel interno.
	 *
	 * Casa por substring de propósito: os nomes sao editaveis no admin e no
	 * Stripe, e exigir igualdade exata quebraria o gate silenciosamente na
	 * primeira vez que alguem renomeasse "Premium" pra "Plano Premium".
	 * A ordem importa — `global_investor` e checado antes de `premium`
	 * porque um nome pode conter os dois.
	 */
	static tierFromPlanName(rawName: string | undefined | null): UserPlanTier {
		const name = String(rawName || '')
			.toLowerCase()
			.trim();
		if (!name) return 'free';

		if (name.includes('global') || name.includes('investor')) {
			return 'global_investor';
		}
		if (name.includes('premium')) return 'premium';
		if (name.includes('pro')) return 'pro';
		return 'free';
	}
}
