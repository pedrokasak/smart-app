import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { isStripeResourceMissing } from '../stripe.service';
import { StripeSubscriptionSyncService } from './stripe-subscription-sync.service';

export type CheckoutConfirmation =
	/** Pago e plano liberado. */
	| { state: 'confirmed'; subscriptionStatus: string }
	/** Checkout concluído, pagamento ainda não compensado (ex.: boleto). */
	| { state: 'pending_payment' }
	/** O usuário não terminou o checkout (sessão aberta ou expirada). */
	| { state: 'not_completed' }
	/** Pago, mas não foi possível liberar o plano automaticamente. */
	| { state: 'failed' };

const PAID = new Set(['paid', 'no_payment_required']);
const GRANTING = new Set(['active', 'trialing']);

/**
 * Confirma um checkout do Stripe sem depender do webhook.
 *
 * O plano era liberado só pelo webhook. Sem endpoint configurado (incidente
 * de 27/09/2026) o cliente pagava e continuava no plano gratuito. A tela de
 * sucesso agora chama esta confirmação com o `session_id` do redirect; o
 * webhook `checkout.session.completed` usa o mesmo caminho.
 */
@Injectable()
export class CheckoutConfirmationService {
	private readonly logger = new Logger(CheckoutConfirmationService.name);

	constructor(
		private readonly stripe: Stripe,
		private readonly subscriptionSync: StripeSubscriptionSyncService
	) {}

	/** Pela tela de sucesso: a sessão precisa ser do usuário do token. */
	async confirmForUser(
		userId: string,
		sessionId: string
	): Promise<CheckoutConfirmation> {
		const session = await this.retrieveSession(sessionId);

		// Mesma resposta para sessão inexistente e sessão de outra pessoa:
		// quem testa ids não aprende nada.
		if (session.metadata?.userId !== userId) {
			throw new NotFoundException('Sessão de checkout não encontrada.');
		}
		if (session.mode !== 'subscription') {
			throw new BadRequestException('Sessão de checkout não é de assinatura.');
		}

		return this.applySession(session);
	}

	/**
	 * Aplica uma sessão já confiável (evento assinado do webhook ou sessão
	 * conferida acima). O dono vem de `metadata.userId`, gravado pelo server
	 * na criação do checkout.
	 */
	async applySession(
		session: Stripe.Checkout.Session
	): Promise<CheckoutConfirmation> {
		const userId = session.metadata?.userId;
		if (session.mode !== 'subscription' || !userId) {
			this.logger.warn(
				`Sessão ${session.id} sem assinatura ou sem metadata.userId; ignorada.`
			);
			return { state: 'failed' };
		}
		if (session.status !== 'complete') return { state: 'not_completed' };
		if (!PAID.has(session.payment_status)) return { state: 'pending_payment' };

		const subscription = await this.resolveSubscription(session);
		if (!subscription) {
			this.logger.error(`Sessão ${session.id} paga sem assinatura associada.`);
			return { state: 'failed' };
		}

		const result = await this.subscriptionSync.syncForUser(
			userId,
			subscription
		);
		if (result.synced === false) return { state: 'failed' };
		if (!GRANTING.has(result.status)) return { state: 'pending_payment' };

		return { state: 'confirmed', subscriptionStatus: result.status };
	}

	private async retrieveSession(
		sessionId: string
	): Promise<Stripe.Checkout.Session> {
		try {
			return await this.stripe.checkout.sessions.retrieve(sessionId, {
				expand: ['subscription'],
			});
		} catch (error) {
			if (isStripeResourceMissing(error)) {
				throw new NotFoundException('Sessão de checkout não encontrada.');
			}
			throw error;
		}
	}

	private async resolveSubscription(
		session: Stripe.Checkout.Session
	): Promise<Stripe.Subscription | null> {
		const value = session.subscription;
		if (!value) return null;
		if (typeof value !== 'string') return value;
		return this.stripe.subscriptions.retrieve(value);
	}
}
