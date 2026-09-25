import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { pixPeriodFor } from 'src/payments/pix/domain/pix-billing';
import { PixCharge } from 'src/payments/pix/infrastructure/pix-charge.model';
import { UserSubscription } from 'src/subscription/schema';

/** Evento do webhook já autenticado e com o formato mínimo validado. */
export interface PixProviderEvent {
	event: string;
	payment: { id: string; value?: number; paymentDate?: string | null };
}

export type PixEventOutcome =
	| 'activated'
	| 'duplicate'
	| 'unknown_payment'
	| 'needs_review'
	| 'expired'
	| 'refunded'
	| 'ignored';

const PAID_EVENTS = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']);
const EXPIRED_EVENTS = new Set(['PAYMENT_OVERDUE']);
const REVERSED_EVENTS = new Set([
	'PAYMENT_REFUNDED',
	'PAYMENT_DELETED',
	'PAYMENT_CHARGEBACK_REQUESTED',
]);

/** Tolerância de arredondamento entre o valor cobrado e o recebido. */
const AMOUNT_TOLERANCE = 0.01;

/**
 * Traduz eventos do provedor de PIX em estado de assinatura (TRA-195).
 *
 * Idempotência: o provedor reenvia webhook até receber 200, e pode mandar
 * RECEIVED e CONFIRMED para o mesmo pagamento. A liberação acontece dentro de
 * uma transição atômica `pending|expired -> paid` na cobrança: só a primeira
 * entrega passa por ela; as outras viram `duplicate` e não estendem o período
 * de novo.
 */
@Injectable()
export class PixPaymentConfirmationService {
	private readonly logger = new Logger(PixPaymentConfirmationService.name);

	constructor(
		@InjectModel('PixCharge')
		private readonly chargeModel: Model<PixCharge>,
		@InjectModel('UserSubscription')
		private readonly userSubscriptionModel: Model<UserSubscription>
	) {}

	async handle(
		event: PixProviderEvent,
		now: Date = new Date()
	): Promise<PixEventOutcome> {
		if (PAID_EVENTS.has(event.event)) return this.confirm(event, now);
		if (EXPIRED_EVENTS.has(event.event)) return this.expire(event);
		if (REVERSED_EVENTS.has(event.event)) return this.reverse(event, now);
		return 'ignored';
	}

	private async confirm(
		event: PixProviderEvent,
		now: Date
	): Promise<PixEventOutcome> {
		const charge = await this.chargeModel.findOneAndUpdate(
			{
				asaasPaymentId: event.payment.id,
				// `expired` também: PIX pago no último minuto pode chegar
				// depois do OVERDUE. O dinheiro entrou; o plano tem que sair.
				status: { $in: ['pending', 'expired'] },
			},
			{ $set: { status: 'paid', paidAt: now } },
			{ new: true }
		);

		if (!charge) {
			const known = await this.chargeModel.exists({
				asaasPaymentId: event.payment.id,
			});
			if (!known) {
				this.logger.warn(
					`Pagamento PIX ${event.payment.id} sem cobrança no Trackerr — ignorado.`
				);
				return 'unknown_payment';
			}
			return 'duplicate';
		}

		try {
			return await this.activate(charge, event, now);
		} catch (error) {
			// A cobrança já foi marcada `paid` acima. Se a liberação falhou no
			// meio, a reentrega do webhook cairia em `duplicate` e o cliente que
			// pagou nunca receberia o plano. Devolve a cobrança para `pending`:
			// o provedor reenvia (respondemos 500) e a próxima entrega refaz tudo.
			await this.chargeModel.updateOne(
				{ _id: charge._id, status: 'paid' },
				{ $set: { status: 'pending' }, $unset: { paidAt: '' } }
			);
			this.logger.error(
				`Falha ao liberar plano do PIX ${event.payment.id}; cobrança reaberta para a reentrega: ${
					(error as Error)?.message
				}`
			);
			throw error;
		}
	}

	private async activate(
		charge: PixCharge,
		event: PixProviderEvent,
		now: Date
	): Promise<PixEventOutcome> {
		const received = Number(event.payment.value);
		if (
			!Number.isFinite(received) ||
			received + AMOUNT_TOLERANCE < charge.amount
		) {
			return this.flagForReview(
				charge,
				`valor recebido ${received} menor que o cobrado ${charge.amount}`
			);
		}

		const current = await this.userSubscriptionModel.findOne({
			user: charge.user,
			status: { $in: ['active', 'trialing'] },
		});

		if (
			current?.stripeSubscriptionId &&
			current.status === 'active' &&
			current.currentPeriodEnd > now
		) {
			// O checkout recusa isto, mas o cartão pode ter sido assinado
			// entre a emissão do QR e o pagamento. Não sobrescrever a
			// assinatura do Stripe: o PIX precisa de estorno manual.
			return this.flagForReview(charge, 'assinatura de cartão ativa');
		}

		const samePlan = current && String(current.plan) === String(charge.plan);
		const period = pixPeriodFor(
			charge.interval,
			now,
			samePlan ? current.currentPeriodEnd : null
		);

		await this.userSubscriptionModel.findOneAndUpdate(
			{ user: charge.user, status: { $in: ['active', 'trialing'] } },
			{
				$set: {
					plan: charge.plan,
					status: 'active',
					currentPeriodStart: period.start,
					currentPeriodEnd: period.end,
					cancelAtPeriodEnd: false,
					paymentProvider: 'asaas_pix',
					lastPixChargeId: String(charge._id),
					quantity: 1,
				},
				$unset: { trialStart: '', trialEnd: '', canceledAt: '', endedAt: '' },
				$setOnInsert: { user: charge.user },
			},
			{ new: true, upsert: true, setDefaultsOnInsert: true }
		);

		await this.chargeModel.updateOne(
			{ _id: charge._id },
			{ $set: { periodStart: period.start, periodEnd: period.end } }
		);

		this.logger.log(
			`PIX ${event.payment.id} confirmado: plano liberado até ${period.end.toISOString()}.`
		);
		return 'activated';
	}

	private async expire(event: PixProviderEvent): Promise<PixEventOutcome> {
		await this.chargeModel.updateOne(
			{ asaasPaymentId: event.payment.id, status: 'pending' },
			{ $set: { status: 'expired' } }
		);
		return 'expired';
	}

	/**
	 * Estorno/chargeback: a cobrança deixa de valer. Se foi ela que liberou o
	 * plano atual, o plano cai agora — não no fim do período.
	 */
	private async reverse(
		event: PixProviderEvent,
		now: Date
	): Promise<PixEventOutcome> {
		const charge = await this.chargeModel.findOneAndUpdate(
			{ asaasPaymentId: event.payment.id, status: { $ne: 'refunded' } },
			{ $set: { status: 'refunded' } },
			{ new: false }
		);
		if (!charge) return 'duplicate';

		if (charge.status === 'paid') {
			const filter = {
				user: charge.user,
				lastPixChargeId: String(charge._id),
				status: { $in: ['active', 'trialing'] },
			};
			// Pagamento que só ESTENDEU um período ainda em curso: estornar
			// devolve o fim para onde estava, sem tirar os dias já pagos antes.
			if (charge.periodStart && charge.periodStart > now) {
				await this.userSubscriptionModel.updateOne(filter, {
					$set: { currentPeriodEnd: charge.periodStart },
				});
			} else {
				await this.userSubscriptionModel.updateOne(filter, {
					$set: { status: 'canceled', canceledAt: now, endedAt: now },
				});
			}
		}
		return 'refunded';
	}

	private async flagForReview(
		charge: PixCharge,
		reason: string
	): Promise<PixEventOutcome> {
		await this.chargeModel.updateOne(
			{ _id: charge._id },
			{ $set: { status: 'needs_review', reviewReason: reason } }
		);
		this.logger.error(
			`PIX ${charge.asaasPaymentId} pago mas NÃO liberado (${reason}). Cobrança ${charge._id} exige revisão manual.`
		);
		return 'needs_review';
	}
}
