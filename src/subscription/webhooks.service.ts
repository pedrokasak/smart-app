import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Stripe from 'stripe';
import { Subscription, UserSubscription } from './schema';
import { User } from 'src/users/schema/user.model';

@Injectable()
export class WebhooksService {
	private readonly logger = new Logger(WebhooksService.name);

	constructor(
		@InjectModel('User')
		private userModel: Model<User>,
		@InjectModel('Subscription')
		private subscriptionModel: Model<Subscription>,
		@InjectModel('UserSubscription')
		private userSubscriptionModel: Model<UserSubscription>
	) {}

	/**
	 * A partir da API 2025-08-27.basil o Stripe expõe current_period_start/end
	 * no item da assinatura, e não mais no objeto raiz. Lê do item e mantém
	 * fallback na raiz para compatibilidade com versões anteriores.
	 */
	private resolvePeriod(subscription: Stripe.Subscription): {
		start: Date;
		end: Date;
	} {
		const item = subscription.items?.data?.[0] as any;
		const root = subscription as any;

		const startUnix = item?.current_period_start ?? root.current_period_start;
		const endUnix = item?.current_period_end ?? root.current_period_end;

		return {
			start: startUnix ? new Date(startUnix * 1000) : new Date(),
			end: endUnix
				? new Date(endUnix * 1000)
				: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		};
	}

	// Processar webhook do Stripe
	async handleWebhook(event: Stripe.Event): Promise<void> {
		try {
			this.logger.log(`Processando webhook: ${event.type}`);

			switch (event.type) {
				case 'customer.subscription.created':
					await this.handleSubscriptionCreated(
						event.data.object as Stripe.Subscription
					);
					break;
				case 'customer.subscription.updated':
					await this.handleSubscriptionUpdated(
						event.data.object as Stripe.Subscription
					);
					break;
				case 'customer.subscription.deleted':
					await this.handleSubscriptionDeleted(
						event.data.object as Stripe.Subscription
					);
					break;
				case 'invoice.payment_succeeded':
					await this.handlePaymentSucceeded(
						event.data.object as Stripe.Invoice
					);
					break;
				case 'invoice.payment_failed':
					await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
					break;
				case 'customer.subscription.trial_will_end':
					await this.handleTrialWillEnd(
						event.data.object as Stripe.Subscription
					);
					break;
				default:
					this.logger.log(`Webhook não processado: ${event.type}`);
			}
		} catch (error) {
			this.logger.error(`Erro ao processar webhook ${event.type}:`, error);
			throw error;
		}
	}

	// Assinatura criada
	private async handleSubscriptionCreated(
		subscription: Stripe.Subscription
	): Promise<void> {
		try {
			const userSubscription = await this.userSubscriptionModel.findOne({
				stripeSubscriptionId: subscription.id,
			});

			if (userSubscription) {
				this.logger.log(`Assinatura já existe: ${subscription.id}`);
				return;
			}

			// Resolve o plano tanto pelo preco MENSAL quanto pelo ANUAL: o
			// checkout anual usa annualStripePriceId, entao um assinante anual
			// chega aqui com um price.id que NAO esta em stripePriceId. Sem o
			// $or, a assinatura anual nao encontrava o plano e o UserSubscription
			// nunca era criado — usuario pagava e continuava 'free'.
			const priceId = subscription.items.data[0].price.id;
			const plan = await this.subscriptionModel.findOne({
				$or: [{ stripePriceId: priceId }, { annualStripePriceId: priceId }],
			});

			if (!plan) {
				this.logger.error(`Plano não encontrado para price ID: ${priceId}`);
				return;
			}

			const stripeCustomerId = subscription.customer as string;
			const user = await this.userModel.findOne({ stripeCustomerId });

			if (!user) {
				this.logger.error(
					`Usuário não encontrado para stripeCustomerId: ${stripeCustomerId}`
				);
				return;
			}

			const newUserSubscription = new this.userSubscriptionModel({
				user: user._id,
				plan: plan._id,
				stripeSubscriptionId: subscription.id,
				stripeCustomerId: subscription.customer as string,
				status: subscription.status,
				currentPeriodStart: this.resolvePeriod(subscription).start,
				currentPeriodEnd: this.resolvePeriod(subscription).end,
				cancelAtPeriodEnd: subscription.cancel_at_period_end,
				trialStart: (subscription as any).trial_start
					? new Date((subscription as any).trial_start * 1000)
					: undefined,
				trialEnd: (subscription as any).trial_end
					? new Date((subscription as any).trial_end * 1000)
					: undefined,
				quantity: subscription.items.data[0].quantity || 1,
			});

			await newUserSubscription.save();
			this.logger.log(`Assinatura criada: ${subscription.id}`);
		} catch (error) {
			this.logger.error('Erro ao processar assinatura criada:', error);
			throw error;
		}
	}

	// Assinatura atualizada
	private async handleSubscriptionUpdated(
		subscription: Stripe.Subscription
	): Promise<void> {
		try {
			const userSubscription = await this.userSubscriptionModel.findOne({
				stripeSubscriptionId: subscription.id,
			});

			if (!userSubscription) {
				this.logger.error(`Assinatura não encontrada: ${subscription.id}`);
				return;
			}

			// Atualizar campos da assinatura
			const period = this.resolvePeriod(subscription);
			userSubscription.status = subscription.status as any;
			userSubscription.currentPeriodStart = period.start;
			userSubscription.currentPeriodEnd = period.end;
			userSubscription.cancelAtPeriodEnd = subscription.cancel_at_period_end;
			userSubscription.quantity = subscription.items.data[0].quantity || 1;

			if ((subscription as any).canceled_at) {
				userSubscription.canceledAt = new Date(
					(subscription as any).canceled_at * 1000
				);
			}

			if ((subscription as any).ended_at) {
				userSubscription.endedAt = new Date(
					(subscription as any).ended_at * 1000
				);
			}

			await userSubscription.save();
			this.logger.log(`Assinatura atualizada: ${subscription.id}`);
		} catch (error) {
			this.logger.error('Erro ao processar assinatura atualizada:', error);
			throw error;
		}
	}

	// Assinatura deletada
	private async handleSubscriptionDeleted(
		subscription: Stripe.Subscription
	): Promise<void> {
		try {
			const userSubscription = await this.userSubscriptionModel.findOne({
				stripeSubscriptionId: subscription.id,
			});

			if (!userSubscription) {
				this.logger.error(`Assinatura não encontrada: ${subscription.id}`);
				return;
			}

			userSubscription.status = 'canceled';
			userSubscription.endedAt = new Date();
			await userSubscription.save();

			this.logger.log(`Assinatura cancelada: ${subscription.id}`);
		} catch (error) {
			this.logger.error('Erro ao processar assinatura deletada:', error);
			throw error;
		}
	}

	// Pagamento realizado com sucesso
	private async handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
		try {
			const subscriptionId = (
				invoice as Stripe.Invoice & { subscription: string }
			).subscription;
			if (!subscriptionId) {
				this.logger.log(
					`Invoice ${invoice.id} não está associada a uma assinatura, ignorando.`
				);
				return;
			}

			const userSubscription = await this.userSubscriptionModel.findOne({
				stripeSubscriptionId: subscriptionId,
			});

			if (!userSubscription) {
				this.logger.error(
					`Assinatura ${subscriptionId} não encontrada para a invoice ${invoice.id}`
				);
				return;
			}

			// Atualiza as informações com base na fatura paga
			userSubscription.status = 'active'; // Garante que está ativa
			userSubscription.currentPeriodStart = new Date(
				invoice.period_start * 1000
			);
			userSubscription.currentPeriodEnd = new Date(invoice.period_end * 1000);

			await userSubscription.save();

			this.logger.log(
				`Pagamento bem-sucedido e assinatura atualizada para a invoice: ${invoice.id}`
			);
		} catch (error) {
			this.logger.error(
				`Erro ao processar pagamento bem-sucedido para a invoice ${invoice.id}:`,
				error
			);
			throw error;
		}
	}

	// Pagamento falhou
	private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
		try {
			const subscriptionId = (
				invoice as Stripe.Invoice & { subscription: string }
			).subscription;
			if (!subscriptionId) {
				this.logger.log('Invoice sem assinatura, ignorando');
				return;
			}

			const userSubscription = await this.userSubscriptionModel.findOne({
				stripeSubscriptionId: subscriptionId,
			});

			if (!userSubscription) {
				this.logger.error(
					`Assinatura não encontrada para invoice: ${invoice.id}`
				);
				return;
			}

			// Atualizar status para past_due ou unpaid
			userSubscription.status = 'past_due';
			await userSubscription.save();

			this.logger.log(`Pagamento falhou: ${invoice.id}`);
		} catch (error) {
			this.logger.error('Erro ao processar pagamento falhou:', error);
			throw error;
		}
	}

	// Período de teste vai terminar
	private async handleTrialWillEnd(
		subscription: Stripe.Subscription
	): Promise<void> {
		try {
			const userSubscription = await this.userSubscriptionModel.findOne({
				stripeSubscriptionId: subscription.id,
			});

			if (!userSubscription) {
				this.logger.error(`Assinatura não encontrada: ${subscription.id}`);
				return;
			}

			this.logger.log(
				`Período de teste vai terminar para assinatura: ${subscription.id}`
			);
		} catch (error) {
			this.logger.error('Erro ao processar fim do período de teste:', error);
			throw error;
		}
	}

	async checkExpiredSubscriptions(): Promise<void> {
		try {
			const expiredSubscriptions = await this.userSubscriptionModel.find({
				currentPeriodEnd: { $lt: new Date() },
				status: { $in: ['active', 'trialing'] },
			});

			for (const subscription of expiredSubscriptions) {
				subscription.status = 'unpaid';
				await subscription.save();
				this.logger.log(
					`Assinatura expirada: ${subscription.stripeSubscriptionId}`
				);
			}
		} catch (error) {
			this.logger.error('Erro ao verificar assinaturas expiradas:', error);
			throw error;
		}
	}
}
