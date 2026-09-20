import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subscription } from './schema';
import { User } from 'src/users/schema/user.model';

/**
 * Objeto que não existe para a chave em uso. O caso comum é ID gravado num
 * modo e consultado no outro ("a similar object exists in test mode, but a
 * live mode key was used"), que a Stripe reporta com este mesmo `code`.
 * Distinguir isso de falha de rede importa: só a ausência confirmada
 * justifica descartar um vínculo gravado.
 */
export function isStripeResourceMissing(error: unknown): boolean {
	return (error as Stripe.errors.StripeError)?.code === 'resource_missing';
}

@Injectable()
export class StripeService {
	private readonly stripe: Stripe;
	private readonly logger = new Logger(StripeService.name);

	constructor(
		@InjectModel('Subscription') private subscriptionModel: Model<Subscription>,
		@InjectModel('User') private userModel: Model<User>
	) {
		this.stripe = new Stripe(process.env.STRIPE_PRIVATE_API_KEY, {
			apiVersion: '2025-08-27.basil',
		});
	}

	async createProduct(
		name: string,
		description?: string
	): Promise<Stripe.Product> {
		try {
			const product = await this.stripe.products.create({
				name,
				description,
			});
			this.logger.log(`Produto criado no Stripe: ${product.id}`);
			return product;
		} catch (error) {
			this.logger.error('Erro ao criar produto no Stripe:', error);
			throw error;
		}
	}

	async createPrice(
		productId: string,
		price: number,
		currency: string = 'brl',
		interval: 'month' | 'year' | 'week' | 'day' = 'month',
		intervalCount: number = 1
	): Promise<Stripe.Price> {
		try {
			const stripePrice = await this.stripe.prices.create({
				product: productId,
				unit_amount: Math.round(price * 100), // Stripe usa centavos
				currency,
				recurring: {
					interval,
					interval_count: intervalCount,
				},
			});
			this.logger.log(`Preço criado no Stripe: ${stripePrice.id}`);
			return stripePrice;
		} catch (error) {
			this.logger.error('Erro ao criar preço no Stripe:', error);
			throw error;
		}
	}

	async updateProduct(
		productId: string,
		data: {
			name?: string;
			description?: string;
			active?: boolean;
		}
	): Promise<Stripe.Product> {
		try {
			const product = await this.stripe.products.update(productId, {
				name: data.name,
				description: data.description,
				active: data.active,
			});
			this.logger.log(`Produto atualizado no Stripe: ${product.id}`);
			return product;
		} catch (error) {
			this.logger.error('Erro ao atualizar produto no Stripe:', error);
			throw error;
		}
	}

	/**
	 * Preços no Stripe são imutáveis — trocar valor, moeda ou intervalo
	 * sempre cria um preço novo. Arquivar o antigo (`active: false`) evita
	 * que ele fique acumulando como preço ativo órfão na conta a cada edição.
	 */
	async archivePrice(priceId: string): Promise<Stripe.Price> {
		try {
			const price = await this.stripe.prices.update(priceId, {
				active: false,
			});
			this.logger.log(`Preço arquivado no Stripe: ${price.id}`);
			return price;
		} catch (error) {
			this.logger.error('Erro ao arquivar preço no Stripe:', error);
			throw error;
		}
	}

	async createCustomer(email: string, name?: string): Promise<Stripe.Customer> {
		try {
			const customer = await this.stripe.customers.create({
				email,
				name,
			});
			this.logger.log(`Cliente criado no Stripe: ${customer.id}`);
			return customer;
		} catch (error) {
			this.logger.error('Erro ao criar cliente no Stripe:', error);
			throw error;
		}
	}

	async createSubscription(
		customerId: string,
		priceId: string,
		trialDays?: number
	): Promise<Stripe.Subscription> {
		try {
			const subscriptionData: Stripe.SubscriptionCreateParams = {
				customer: customerId,
				items: [{ price: priceId }],
				payment_behavior: 'default_incomplete',
				payment_settings: { save_default_payment_method: 'on_subscription' },
				expand: ['latest_invoice.payment_intent'],
			};

			if (trialDays) {
				subscriptionData.trial_period_days = trialDays;
			}

			const subscription =
				await this.stripe.subscriptions.create(subscriptionData);
			this.logger.log(`Assinatura criada no Stripe: ${subscription.id}`);
			return subscription;
		} catch (error) {
			this.logger.error('Erro ao criar assinatura no Stripe:', error);
			throw error;
		}
	}

	async cancelSubscription(
		subscriptionId: string,
		cancelAtPeriodEnd: boolean = true
	): Promise<Stripe.Subscription> {
		try {
			const subscription = await this.stripe.subscriptions.update(
				subscriptionId,
				{
					cancel_at_period_end: cancelAtPeriodEnd,
				}
			);
			this.logger.log(`Assinatura cancelada no Stripe: ${subscriptionId}`);
			return subscription;
		} catch (error) {
			this.logger.error('Erro ao cancelar assinatura no Stripe:', error);
			throw error;
		}
	}

	async updateSubscription(
		subscriptionId: string,
		priceId: string,
		prorationBehavior: 'create_prorations' | 'none' = 'create_prorations'
	): Promise<Stripe.Subscription> {
		try {
			const subscription =
				await this.stripe.subscriptions.retrieve(subscriptionId);

			const updatedSubscription = await this.stripe.subscriptions.update(
				subscriptionId,
				{
					items: [
						{
							id: subscription.items.data[0].id,
							price: priceId,
						},
					],
					proration_behavior: prorationBehavior,
				}
			);

			this.logger.log(`Assinatura atualizada no Stripe: ${subscriptionId}`);
			return updatedSubscription;
		} catch (error) {
			this.logger.error('Erro ao atualizar assinatura no Stripe:', error);
			throw error;
		}
	}

	async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
		try {
			const subscription = await this.stripe.subscriptions.retrieve(
				subscriptionId,
				{
					expand: ['customer', 'latest_invoice'],
				}
			);
			return subscription;
		} catch (error) {
			this.logger.error('Erro ao buscar assinatura no Stripe:', error);
			throw error;
		}
	}

	async createCheckoutSession(
		userId: string,
		priceId: string,
		successUrl: string,
		cancelUrl: string
	): Promise<Stripe.Checkout.Session> {
		try {
			const user = await this.userModel.findById(userId);
			if (!user) {
				throw new NotFoundException('Usuário não encontrado');
			}

			let stripeCustomerId = user.stripeCustomerId;

			if (!stripeCustomerId) {
				const customer = await this.createCustomer(user.email, user.firstName);
				stripeCustomerId = customer.id;

				user.stripeCustomerId = stripeCustomerId;
				await user.save();
			}

			const session = await this.stripe.checkout.sessions.create({
				metadata: {
					userId,
				},
				customer: stripeCustomerId,
				payment_method_types: ['card', 'boleto'],
				line_items: [
					{
						price: priceId,
						quantity: 1,
					},
				],
				mode: 'subscription',
				// Cupons criados no Stripe (ex.: cobrança de teste) entram no checkout.
				allow_promotion_codes: true,
				success_url: successUrl,
				cancel_url: cancelUrl,
			});
			this.logger.log(`Sessão de checkout criada: ${session.id}`);
			return session;
		} catch (error) {
			this.logger.error('Erro ao criar sessão de checkout:', error);
			throw error;
		}
	}

	/** Últimas faturas do cliente, mais recentes primeiro. */
	async listCustomerInvoices(
		customerId: string,
		limit = 12
	): Promise<Stripe.Invoice[]> {
		const invoices = await this.stripe.invoices.list({
			customer: customerId,
			limit,
		});
		return invoices.data;
	}

	// Criar portal de gerenciamento do cliente
	async createCustomerPortalSession(
		customerId: string,
		returnUrl: string
	): Promise<Stripe.BillingPortal.Session> {
		try {
			const session = await this.stripe.billingPortal.sessions.create({
				customer: customerId,
				return_url: returnUrl,
			});

			this.logger.log(`Sessão do portal criada para cliente: ${customerId}`);
			return session;
		} catch (error) {
			this.logger.error('Erro ao criar sessão do portal:', error);
			throw error;
		}
	}

	// Verificar assinatura de teste
	async verifyTrialSubscription(subscriptionId: string): Promise<boolean> {
		try {
			const subscription =
				await this.stripe.subscriptions.retrieve(subscriptionId);
			return subscription.status === 'trialing';
		} catch (error) {
			this.logger.error('Erro ao verificar assinatura de teste:', error);
			return false;
		}
	}

	// Status básico do webhook: apenas confirma se o secret está configurado
	// no ambiente do server. Não faz handshake real com o Stripe (TRA-115).
	getWebhookStatus(): { configured: boolean } {
		return {
			configured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
		};
	}

	// Eventos recentes direto da API de Events do Stripe — o Stripe já é a
	// fonte de verdade para histórico de eventos, então não duplicamos isso
	// em uma tabela local (TRA-115).
	async listRecentEvents(limit: number = 20): Promise<Stripe.Event[]> {
		try {
			const events = await this.stripe.events.list({ limit });
			return events.data;
		} catch (error) {
			this.logger.error('Erro ao listar eventos do Stripe:', error);
			throw error;
		}
	}
}
