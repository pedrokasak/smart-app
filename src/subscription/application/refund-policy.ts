/** Direito de arrependimento (CDC art. 49): 7 dias a partir da cobrança. */
export const REFUND_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cobrança do provedor reduzida ao que a política precisa. */
export interface ChargeSnapshot {
	id: string;
	/** Menor unidade da moeda (centavos). */
	amount: number;
	currency: string;
	/** Epoch em segundos, como o Stripe entrega. */
	created: number;
	succeeded: boolean;
	amountRefunded: number;
}

export type RefundIneligibleReason =
	| 'no_subscription'
	| 'unsupported_provider'
	| 'no_charge'
	| 'already_refunded'
	| 'not_first_charge'
	| 'window_expired';

export interface EligibleRefund {
	eligible: true;
	chargeId: string;
	amount: number;
	currency: string;
	deadline: Date;
}

export interface IneligibleRefund {
	eligible: false;
	reason: RefundIneligibleReason;
}

export type RefundDecision = EligibleRefund | IneligibleRefund;

/** Guarda explícita: o projeto roda sem strictNullChecks, que o narrowing por `eligible` exige. */
export function isEligible(decision: RefundDecision): decision is EligibleRefund {
	return decision.eligible === true;
}

/**
 * Reembolso por conta própria só vale para a primeira compra, uma única vez.
 * Qualquer cobrança já estornada bloqueia (evita comprar, estornar e repetir)
 * e uma segunda cobrança bem-sucedida indica renovação, que já saiu da janela
 * de arrependimento.
 */
export function evaluateRefund(
	charges: ChargeSnapshot[],
	now: Date = new Date()
): RefundDecision {
	const succeeded = charges.filter((charge) => charge.succeeded);
	if (succeeded.length === 0) return { eligible: false, reason: 'no_charge' };

	if (succeeded.some((charge) => charge.amountRefunded > 0)) {
		return { eligible: false, reason: 'already_refunded' };
	}
	if (succeeded.length > 1) {
		return { eligible: false, reason: 'not_first_charge' };
	}

	const [charge] = succeeded;
	const deadline = new Date(
		charge.created * 1000 + REFUND_WINDOW_DAYS * DAY_MS
	);
	if (now.getTime() > deadline.getTime()) {
		return { eligible: false, reason: 'window_expired' };
	}

	return {
		eligible: true,
		chargeId: charge.id,
		amount: charge.amount,
		currency: charge.currency,
		deadline,
	};
}

export const REFUND_REASON_MESSAGES: Record<RefundIneligibleReason, string> = {
	no_subscription: 'Você não tem uma assinatura paga ativa.',
	unsupported_provider:
		'Pagamentos por PIX ou concessão manual são reembolsados pelo suporte: suporte@trackerr.com.br.',
	no_charge:
		'Ainda não há cobrança para reembolsar. Se quiser, cancele a assinatura para não ser cobrado.',
	already_refunded: 'Esta compra já foi reembolsada.',
	not_first_charge:
		'O reembolso automático vale só para a primeira cobrança. Para renovações, fale com o suporte.',
	window_expired: `O prazo de ${REFUND_WINDOW_DAYS} dias para reembolso já passou. Você ainda pode cancelar para não ser cobrado de novo.`,
};
