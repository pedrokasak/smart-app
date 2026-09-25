/**
 * Regras de cobrança PIX sem dependência de infraestrutura (TRA-195).
 *
 * PIX não tem débito recorrente: cada pagamento compra UM período (mês ou
 * ano). Renovar é pagar de novo. Quando o período acaba sem novo pagamento, o
 * `SubscriptionExpiryScheduler` que já existe devolve o usuário ao gratuito.
 */
export type PixInterval = 'month' | 'year';

export const PIX_INTERVALS: PixInterval[] = ['month', 'year'];

/** Quanto tempo o QR code fica válido antes de gerarmos outro. */
export const PIX_CHARGE_TTL_MS = 24 * 60 * 60 * 1000;

export interface PixPricedPlan {
	price?: number | null;
	annualPrice?: number | null;
	isActive?: boolean;
}

/**
 * Valor em BRL do período, ou `null` quando o plano não vende esse período
 * por PIX (gratuito, inativo ou sem preço anual).
 */
export function pixAmountFor(
	plan: PixPricedPlan,
	interval: PixInterval
): number | null {
	if (plan.isActive === false) return null;
	const amount = interval === 'year' ? plan.annualPrice : plan.price;
	if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
		return null;
	}
	return Math.round(amount * 100) / 100;
}

/**
 * Período comprado por um pagamento confirmado.
 *
 * Quem paga ANTES de o período atual acabar não perde os dias que faltam: o
 * novo período começa no fim do atual. Quem paga depois (ou assina pela
 * primeira vez) começa agora.
 */
export function pixPeriodFor(
	interval: PixInterval,
	paidAt: Date,
	currentPeriodEnd?: Date | null
): { start: Date; end: Date } {
	const start =
		currentPeriodEnd && currentPeriodEnd.getTime() > paidAt.getTime()
			? new Date(currentPeriodEnd)
			: new Date(paidAt);
	return { start, end: addMonthsClamped(start, interval === 'year' ? 12 : 1) };
}

/**
 * Soma meses sem transbordar: 31/01 + 1 mês = 28/02 (ou 29), não 03/03 como
 * faz `setUTCMonth`. Idem 29/02 + 1 ano = 28/02.
 */
function addMonthsClamped(date: Date, months: number): Date {
	const result = new Date(date);
	const day = result.getUTCDate();
	result.setUTCDate(1);
	result.setUTCMonth(result.getUTCMonth() + months);
	const lastDay = new Date(
		Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
	).getUTCDate();
	result.setUTCDate(Math.min(day, lastDay));
	return result;
}

/** Data de vencimento no formato do Asaas (`YYYY-MM-DD`, fuso de Brasília). */
export function pixDueDate(now: Date): string {
	// Vence no dia seguinte (horário de Brasília): o QR do Asaas vale até o
	// fim do dia de vencimento, então isso dá sempre pelo menos 24 h.
	const brasilia = new Date(now.getTime() - 3 * 60 * 60 * 1000);
	brasilia.setUTCDate(brasilia.getUTCDate() + 1);
	return brasilia.toISOString().slice(0, 10);
}
