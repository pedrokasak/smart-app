import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { Subscription, UserSubscription } from '../schema';
import { resolveStripePeriod } from './stripe-period';

export type StripeSyncResult =
	| { synced: true; status: UserSubscription['status'] }
	| { synced: false; reason: 'unknown_price' | 'owned_by_another_user' };

const DUPLICATE_KEY = 11000;

/**
 * Grava no banco o estado atual de uma assinatura do Stripe para um usuário.
 *
 * Um único caminho para o webhook (`checkout.session.completed`) e para a
 * confirmação pela tela de sucesso: os dois recebem a assinatura lida do
 * Stripe agora, então ela é a fonte de verdade e o registro local só a
 * espelha (CLAUDE.md §4.4). Idempotente: reentregas e confirmações repetidas
 * reescrevem o mesmo estado.
 */
@Injectable()
export class StripeSubscriptionSyncService {
	private readonly logger = new Logger(StripeSubscriptionSyncService.name);

	constructor(
		@InjectModel('Subscription')
		private readonly subscriptionModel: Model<Subscription>,
		@InjectModel('UserSubscription')
		private readonly userSubscriptionModel: Model<UserSubscription>
	) {}

	async syncForUser(
		userId: string,
		subscription: Stripe.Subscription
	): Promise<StripeSyncResult> {
		const item = subscription.items?.data?.[0];
		const priceId = item?.price?.id;
		const plan = priceId
			? await this.subscriptionModel.findOne({
					$or: [{ stripePriceId: priceId }, { annualStripePriceId: priceId }],
				})
			: null;

		if (!plan) {
			this.logger.error(
				`Plano não encontrado para o preço ${priceId ?? '(sem preço)'} da assinatura ${subscription.id}.`
			);
			return { synced: false, reason: 'unknown_price' };
		}

		const period = resolveStripePeriod(subscription);
		const status = subscription.status as UserSubscription['status'];
		const user = new Types.ObjectId(userId);

		try {
			// O filtro inclui o dono: uma assinatura já gravada para OUTRO
			// usuário não casa, o upsert tenta inserir e bate no índice único
			// de `stripeSubscriptionId`. Assim nunca se reatribui assinatura.
			await this.userSubscriptionModel.updateOne(
				{ stripeSubscriptionId: subscription.id, user },
				{
					$set: {
						plan: plan._id,
						stripeCustomerId: String(subscription.customer),
						paymentProvider: 'stripe',
						status,
						currentPeriodStart: period.start,
						currentPeriodEnd: period.end,
						cancelAtPeriodEnd: subscription.cancel_at_period_end,
						quantity: item?.quantity || 1,
						updatedAt: new Date(),
					},
					$setOnInsert: {
						user,
						stripeSubscriptionId: subscription.id,
						createdAt: new Date(),
					},
				},
				{ upsert: true }
			);
		} catch (error) {
			if ((error as { code?: number })?.code === DUPLICATE_KEY) {
				this.logger.error(
					`Assinatura ${subscription.id} já pertence a outro usuário; nada gravado para ${userId}.`
				);
				return { synced: false, reason: 'owned_by_another_user' };
			}
			throw error;
		}

		this.logger.log(
			`Assinatura ${subscription.id} sincronizada para ${userId} (status ${status}).`
		);
		return { synced: true, status };
	}
}
