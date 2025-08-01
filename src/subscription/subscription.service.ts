import {
	Injectable,
	Logger,
	NotFoundException,
	BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CreateUserSubscriptionDto } from './dto/create-user-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { Subscription, UserSubscription } from './schema';
import { StripeService } from './stripe.service';
import { WebhooksService } from './webhooks.service';
import { UpdateFeaturesDto } from './dto/update-features.dto';
import { User } from 'src/users/schema/user.model';

@Injectable()
export class SubscriptionService {
	private readonly logger = new Logger(SubscriptionService.name);

	constructor(
		@InjectModel('Subscription') private subscriptionModel: Model<Subscription>,
		@InjectModel('UserSubscription')
		private userSubscriptionModel: Model<UserSubscription>,
		@InjectModel('User') private userModel: Model<User>,
		private stripeService: StripeService,
		private webhooksService: WebhooksService
	) {}

	// Criar novo plano de assinatura
	async createSubscription(createSubscriptionDto: CreateSubscriptionDto) {
		try {
			// Criar produto no Stripe se não existir
			let stripeProductId = createSubscriptionDto.stripeProductId;
			if (!stripeProductId) {
				const product = await this.stripeService.createProduct(
					createSubscriptionDto.name,
					createSubscriptionDto.description
				);
				stripeProductId = product.id;
			}

			// Criar preço no Stripe se não existir
			let stripePriceId = createSubscriptionDto.stripePriceId;
			if (!stripePriceId) {
				const price = await this.stripeService.createPrice(
					stripeProductId,
					createSubscriptionDto.price,
					createSubscriptionDto.currency,
					createSubscriptionDto.interval,
					createSubscriptionDto.intervalCount
				);
				stripePriceId = price.id;
			}

			// Criar plano no banco de dados
			const subscription = new this.subscriptionModel({
				...createSubscriptionDto,
				stripeProductId,
				stripePriceId,
			});

			await subscription.save();
			this.logger.log(`Plano criado: ${subscription.name}`);

			return subscription;
		} catch (error) {
			this.logger.error('Erro ao criar plano:', error);
			throw new BadRequestException('Erro ao criar plano de assinatura');
		}
	}

	// Buscar todos os planos
	async findAllSubscriptions() {
		try {
			const subscriptions = await this.subscriptionModel
				.find({ isActive: true })
				.sort({ price: 1 });
			return subscriptions;
		} catch (error) {
			this.logger.error('Erro ao buscar planos:', error);
			throw new BadRequestException('Erro ao buscar planos');
		}
	}

	// Buscar plano por ID
	async findSubscriptionById(id: string) {
		try {
			const subscription = await this.subscriptionModel.findById(id);
			if (!subscription) {
				throw new NotFoundException('Plano não encontrado');
			}
			return subscription;
		} catch (error) {
			this.logger.error('Erro ao buscar plano:', error);
			throw error;
		}
	}

	async findCurrentSubscriptionByUser(userId: string) {
		return this.userSubscriptionModel
			.findOne({
				user: userId,
				status: { $in: ['active', 'trialing'] },
			})
			.populate('subscription');
	}

	// Atualizar plano
	async updateSubscription(
		id: string,
		updateSubscriptionDto: UpdateSubscriptionDto
	) {
		try {
			const subscription = await this.subscriptionModel.findById(id);
			if (!subscription) {
				throw new NotFoundException('Plano não encontrado');
			}

			// Atualizar no banco de dados
			Object.assign(subscription, updateSubscriptionDto);
			await subscription.save();

			this.logger.log(`Plano atualizado: ${subscription.name}`);
			return subscription;
		} catch (error) {
			this.logger.error('Erro ao atualizar plano:', error);
			throw error;
		}
	}

	async updateSubscriptionFeatures(
		id: string,
		updateFeaturesDto: UpdateFeaturesDto
	) {
		const subscription = await this.subscriptionModel.findById(id);
		if (!subscription) {
			throw new NotFoundException('Plano não encontrado');
		}

		subscription.features = updateFeaturesDto.features;
		await subscription.save();

		this.logger.log(`Features atualizadas para o plano: ${subscription.name}`);
		return subscription;
	}

	// Remover plano
	async removeSubscription(id: string) {
		try {
			const subscription = await this.subscriptionModel.findById(id);
			if (!subscription) {
				throw new NotFoundException('Plano não encontrado');
			}

			// Desativar plano em vez de deletar
			subscription.isActive = false;
			await subscription.save();

			this.logger.log(`Plano desativado: ${subscription.name}`);
			return { message: 'Plano desativado com sucesso' };
		} catch (error) {
			this.logger.error('Erro ao remover plano:', error);
			throw error;
		}
	}

	// Criar assinatura para usuário
	async createUserSubscription(
		createUserSubscriptionDto: CreateUserSubscriptionDto
	) {
		try {
			// Verificar se o usuário já tem uma assinatura ativa
			const existingSubscription = await this.userSubscriptionModel.findOne({
				user: createUserSubscriptionDto.userId,
				status: { $in: ['active', 'trialing'] },
			});

			if (existingSubscription) {
				throw new BadRequestException('Usuário já possui uma assinatura ativa');
			}

			// Buscar o plano
			const plan = await this.subscriptionModel.findById(
				createUserSubscriptionDto.subscriptionId
			);
			if (!plan) {
				throw new NotFoundException('Plano não encontrado');
			}

			// Criar cliente no Stripe se não existir
			const stripeCustomerId = createUserSubscriptionDto.stripeCustomerId;
			if (!stripeCustomerId) {
				// Aqui você precisaria buscar o email do usuário
				// const user = await this.userService.findById(createUserSubscriptionDto.userId);
				// const customer = await this.stripeService.createCustomer(user.email, user.name);
				// stripeCustomerId = customer.id;
			}

			// Criar assinatura no Stripe
			const stripeSubscription = await this.stripeService.createSubscription(
				stripeCustomerId,
				plan.stripePriceId,
				7 // 7 dias de teste
			);

			// Criar assinatura no banco de dados
			const userSubscription = new this.userSubscriptionModel({
				user: createUserSubscriptionDto.userId,
				subscription: plan._id,
				stripeSubscriptionId: stripeSubscription.id,
				stripeCustomerId,
				status: stripeSubscription.status,
				currentPeriodStart: new Date(
					(stripeSubscription as any).current_period_start * 1000
				),
				currentPeriodEnd: new Date(
					(stripeSubscription as any).current_period_end * 1000
				),
				cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
				trialStart: stripeSubscription.trial_start
					? new Date(stripeSubscription.trial_start * 1000)
					: undefined,
				trialEnd: stripeSubscription.trial_end
					? new Date(stripeSubscription.trial_end * 1000)
					: undefined,
				quantity: createUserSubscriptionDto.quantity || 1,
			});

			await userSubscription.save();
			this.logger.log(
				`Assinatura criada para usuário: ${createUserSubscriptionDto.userId}`
			);

			return userSubscription;
		} catch (error) {
			this.logger.error('Erro ao criar assinatura do usuário:', error);
			throw error;
		}
	}

	// Buscar assinatura do usuário
	async findUserSubscription(userId: string) {
		try {
			const userSubscription = await this.userSubscriptionModel
				.findOne({ user: userId })
				.populate('subscription')
				.sort({ createdAt: -1 });

			if (!userSubscription) {
				throw new NotFoundException('Assinatura não encontrada');
			}

			return userSubscription;
		} catch (error) {
			this.logger.error('Erro ao buscar assinatura do usuário:', error);
			throw error;
		}
	}

	// Cancelar assinatura do usuário
	async cancelUserSubscription(
		userId: string,
		cancelAtPeriodEnd: boolean = true
	) {
		try {
			const userSubscription = await this.userSubscriptionModel.findOne({
				user: userId,
				status: { $in: ['active', 'trialing'] },
			});

			if (!userSubscription) {
				throw new NotFoundException('Assinatura ativa não encontrada');
			}

			// Cancelar no Stripe
			await this.stripeService.cancelSubscription(
				userSubscription.stripeSubscriptionId,
				cancelAtPeriodEnd
			);

			// Atualizar no banco de dados
			userSubscription.cancelAtPeriodEnd = cancelAtPeriodEnd;
			if (!cancelAtPeriodEnd) {
				userSubscription.status = 'canceled';
				userSubscription.endedAt = new Date();
			}
			await userSubscription.save();

			this.logger.log(`Assinatura cancelada para usuário: ${userId}`);
			return { message: 'Assinatura cancelada com sucesso' };
		} catch (error) {
			this.logger.error('Erro ao cancelar assinatura:', error);
			throw error;
		}
	}

	// Criar sessão de checkout
	async createCheckoutSession(
		userId: string,
		subscriptionId: string,
		successUrl: string,
		cancelUrl: string
	) {
		// lógica de negócio
		const user = await this.userModel.findById(userId);
		if (!user) throw new NotFoundException('Usuário não encontrado');

		const plan = await this.subscriptionModel.findById(subscriptionId);
		if (!plan) throw new NotFoundException('Plano não encontrado');

		return this.stripeService.createCheckoutSession(
			user._id.toString(),
			plan._id.toString(),
			successUrl,
			cancelUrl
		);
	}

	async createPortalSession(userId: string, returnUrl: string) {
		try {
			const userSubscription = await this.findUserSubscription(userId);
			const session = await this.stripeService.createCustomerPortalSession(
				userSubscription.stripeCustomerId,
				returnUrl
			);

			return { url: session.url };
		} catch (error) {
			this.logger.error('Erro ao criar sessão do portal:', error);
			throw error;
		}
	}

	async checkExpiredSubscriptions() {
		return this.webhooksService.checkExpiredSubscriptions();
	}
}
