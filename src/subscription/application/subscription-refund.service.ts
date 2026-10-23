import {
	BadRequestException,
	ConflictException,
	Injectable,
	Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserSubscription } from '../schema';
import { StripeService } from '../stripe.service';
import {
	ChargeSnapshot,
	REFUND_REASON_MESSAGES,
	REFUND_WINDOW_DAYS,
	RefundDecision,
	evaluateRefund,
	isEligible,
} from './refund-policy';

export interface RefundEligibility {
	eligible: boolean;
	reason?: string;
	reasonCode?: string;
	/** Valor em reais, para exibir na confirmação. */
	amount?: number;
	currency?: string;
	deadline?: string;
	windowDays: number;
}

export interface RefundResult {
	refunded: true;
	refundId: string;
	amount: number;
	currency: string;
	/** Falso quando o estorno saiu mas o cancelamento imediato falhou. */
	canceled: boolean;
}

const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];
const NON_STRIPE_PROVIDERS = new Set(['asaas_pix', 'manual']);

/**
 * Reembolso por conta própria dentro do prazo de arrependimento (CDC art. 49).
 * Só a assinatura do usuário do token é considerada; o Stripe segue como fonte
 * de verdade das cobranças e a política decide a elegibilidade.
 */
@Injectable()
export class SubscriptionRefundService {
	private readonly logger = new Logger(SubscriptionRefundService.name);

	constructor(
		@InjectModel('UserSubscription')
		private readonly userSubscriptionModel: Model<UserSubscription>,
		private readonly stripeService: StripeService
	) {}

	async checkEligibility(userId: string): Promise<RefundEligibility> {
		const { decision } = await this.decide(userId);
		return this.toEligibility(decision);
	}

	async refund(userId: string): Promise<RefundResult> {
		const { decision, subscription } = await this.decide(userId);
		if (!isEligible(decision)) {
			const message = REFUND_REASON_MESSAGES[decision.reason];
			throw decision.reason === 'already_refunded'
				? new ConflictException(message)
				: new BadRequestException(message);
		}

		const refund = await this.stripeService.refundCharge(decision.chargeId, {
			userId,
			source: 'self_service',
		});

		let canceled = true;
		try {
			await this.stripeService.cancelSubscription(
				subscription.stripeSubscriptionId,
				false
			);
		} catch (error) {
			// O dinheiro já voltou; o acesso encerra pelo webhook de cancelamento
			// ou numa nova tentativa do suporte. Não esconder: fica no log.
			canceled = false;
			this.logger.error(
				`Estorno ${refund.id} feito, mas o cancelamento da assinatura ${subscription.stripeSubscriptionId} falhou — cancelar manualmente`,
				error as Error
			);
		}

		const now = new Date();
		subscription.refundedAt = now;
		subscription.stripeRefundId = refund.id;
		if (canceled) {
			subscription.status = 'canceled';
			subscription.cancelAtPeriodEnd = false;
			subscription.canceledAt = now;
			subscription.endedAt = now;
		}
		await subscription.save();

		this.logger.log(
			`AUDIT subscription.self_refund user=${userId} charge=${decision.chargeId} refund=${refund.id} amount=${decision.amount} ${decision.currency} canceled=${canceled}`
		);

		return {
			refunded: true,
			refundId: refund.id,
			amount: decision.amount / 100,
			currency: decision.currency,
			canceled,
		};
	}

	private async decide(
		userId: string
	): Promise<{ decision: RefundDecision; subscription?: UserSubscription }> {
		const subscription = await this.userSubscriptionModel
			.findOne({ user: userId, status: { $in: ACTIVE_STATUSES } })
			.sort({ createdAt: -1 });
		if (!subscription) {
			return { decision: { eligible: false, reason: 'no_subscription' } };
		}

		const customerId = subscription.stripeCustomerId;
		if (
			!subscription.stripeSubscriptionId ||
			!customerId ||
			NON_STRIPE_PROVIDERS.has(subscription.paymentProvider ?? '')
		) {
			return {
				decision: { eligible: false, reason: 'unsupported_provider' },
			};
		}

		const charges = await this.stripeService.listCustomerCharges(customerId);
		const snapshots: ChargeSnapshot[] = charges.map((charge) => ({
			id: charge.id,
			amount: charge.amount,
			currency: charge.currency,
			created: charge.created,
			succeeded: charge.status === 'succeeded',
			amountRefunded: charge.amount_refunded ?? 0,
		}));
		return { decision: evaluateRefund(snapshots), subscription };
	}

	private toEligibility(decision: RefundDecision): RefundEligibility {
		if (!isEligible(decision)) {
			return {
				eligible: false,
				reasonCode: decision.reason,
				reason: REFUND_REASON_MESSAGES[decision.reason],
				windowDays: REFUND_WINDOW_DAYS,
			};
		}
		return {
			eligible: true,
			amount: decision.amount / 100,
			currency: decision.currency,
			deadline: decision.deadline.toISOString(),
			windowDays: REFUND_WINDOW_DAYS,
		};
	}
}
