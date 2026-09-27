import Stripe from 'stripe';

/**
 * A partir da API 2025-08-27.basil o Stripe expõe current_period_start/end
 * no item da assinatura, e não mais no objeto raiz. Lê do item e mantém
 * fallback na raiz para compatibilidade com versões anteriores.
 */
export function resolveStripePeriod(subscription: Stripe.Subscription): {
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

/**
 * Assinatura de uma fatura. Na API basil o campo saiu da raiz e foi para
 * `parent.subscription_details.subscription`; sem este fallback toda fatura
 * parecia avulsa e `invoice.payment_succeeded` era ignorado.
 */
export function resolveInvoiceSubscriptionId(
	invoice: Stripe.Invoice
): string | null {
	const fromParent = (invoice as any).parent?.subscription_details
		?.subscription;
	const legacy = (invoice as any).subscription;
	const value = fromParent ?? legacy;
	if (!value) return null;
	return typeof value === 'string' ? value : (value.id ?? null);
}
