import { Document, Schema, Types } from 'mongoose';
import {
	PIX_INTERVALS,
	PixInterval,
} from 'src/payments/pix/domain/pix-billing';

/**
 * Estados da cobrança PIX (TRA-195).
 *
 * - `pending`: QR emitido, aguardando pagamento.
 * - `paid`: confirmado pelo webhook; o plano foi liberado.
 * - `expired`: venceu sem pagamento.
 * - `refunded`: estornado/removido no provedor; o plano liberado por ela cai.
 * - `failed`: o provedor recusou a criação — nunca teve QR.
 * - `needs_review`: pago, mas não liberado automaticamente (valor abaixo do
 *   cobrado, ou assinatura de cartão ativa). Exige ação humana.
 */
export type PixChargeStatus =
	| 'pending'
	| 'paid'
	| 'expired'
	| 'refunded'
	| 'failed'
	| 'needs_review';

export interface PixCharge extends Document {
	user: Types.ObjectId;
	plan: Types.ObjectId;
	interval: PixInterval;
	amount: number;
	status: PixChargeStatus;
	asaasPaymentId?: string;
	asaasCustomerId?: string;
	qrCodePayload?: string;
	qrCodeImage?: string;
	expiresAt?: Date;
	paidAt?: Date;
	periodStart?: Date;
	periodEnd?: Date;
	reviewReason?: string;
	createdAt?: Date;
	updatedAt?: Date;
}

export const pixChargeSchema = new Schema<PixCharge>(
	{
		user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		plan: { type: Schema.Types.ObjectId, ref: 'Subscription', required: true },
		interval: { type: String, enum: PIX_INTERVALS, required: true },
		amount: { type: Number, required: true, min: 0 },
		status: {
			type: String,
			enum: [
				'pending',
				'paid',
				'expired',
				'refunded',
				'failed',
				'needs_review',
			],
			default: 'pending',
			required: true,
		},
		// Único: o webhook concilia por aqui, e a transição de estado atômica
		// em cima dele é o que torna a confirmação idempotente.
		asaasPaymentId: { type: String, unique: true, sparse: true },
		asaasCustomerId: String,
		qrCodePayload: String,
		qrCodeImage: String,
		expiresAt: Date,
		paidAt: Date,
		periodStart: Date,
		periodEnd: Date,
		reviewReason: String,
	},
	{ timestamps: true }
);

// Reaproveitar cobrança pendente do mesmo usuário/plano/período.
pixChargeSchema.index({ user: 1, plan: 1, interval: 1, status: 1 });
