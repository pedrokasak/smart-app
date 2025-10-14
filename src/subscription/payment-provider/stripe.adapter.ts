// @Injectable()
// export class StripeAdapter implements PaymentProviderAdapter {
// 	constructor(private readonly stripeService: StripeService) {}

// 	async createProduct(name: string, description?: string): Promise<string> {
// 		const product = await this.stripeService.createProduct(name, description);
// 		return product.id;
// 	}

// 	async createPrice(
// 		productId: string,
// 		price: number,
// 		currency: string,
// 		interval: 'month' | 'year' | 'week' | 'day' = 'month',
// 		intervalCount = 1
// 	): Promise<string> {
// 		const stripePrice = await this.stripeService.createPrice(
// 			productId,
// 			price,
// 			currency,
// 			interval,
// 			intervalCount
// 		);
// 		return stripePrice.id;
// 	}

// 	async createCustomer(email: string, name?: string): Promise<string> {
// 		const customer = await this.stripeService.createCustomer(email, name);
// 		return customer.id;
// 	}

// 	async createSubscription(
// 		customerId: string,
// 		priceId: string,
// 		trialDays?: number
// 	): Promise<PaymentSubscriptionDto> {
// 		const sub = await this.stripeService.createSubscription(
// 			customerId,
// 			priceId,
// 			trialDays
// 		);
// 		return {
// 			id: sub.id,
// 			status: sub.status,
// 			currentPeriodStart: new Date(sub.current_period_start * 1000),
// 			currentPeriodEnd: new Date(sub.current_period_end * 1000),
// 			trialStart: sub.trial_start ? new Date(sub.trial_start * 1000) : null,
// 			trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
// 			cancelAtPeriodEnd: sub.cancel_at_period_end,
// 		};
// 	}

// 	async cancelSubscription(subscriptionId: string, cancelAtPeriodEnd = true) {
// 		const sub = await this.stripeService.cancelSubscription(
// 			subscriptionId,
// 			cancelAtPeriodEnd
// 		);
// 		return {
// 			id: sub.id,
// 			status: sub.status,
// 			cancelAtPeriodEnd: sub.cancel_at_period_end,
// 		};
// 	}

// 	async createCheckoutSession(
// 		customerId: string,
// 		priceId: string,
// 		successUrl?: string,
// 		cancelUrl?: string
// 	): Promise<PaymentCheckoutSessionDto> {
// 		const session = await this.stripeService.createCheckoutSession(
// 			customerId,
// 			priceId,
// 			successUrl,
// 			cancelUrl
// 		);
// 		return {
// 			userId: session.id,
// 			subscriptionId: session.metadata.subscriptionId,
// 			cancelUrl: session.cancel_url,
// 			successUrl: session.success_url,
// 		};
// 	}

// 	async createCustomerPortalSession(customerId: string, returnUrl: string) {
// 		const session = await this.stripeService.createCustomerPortalSession(
// 			customerId,
// 			returnUrl
// 		);
// 		return {
// 			url: session.url,
// 		};
// 	}
// }
