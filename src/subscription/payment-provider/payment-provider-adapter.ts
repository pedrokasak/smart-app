export interface PaymentProviderAdapter {
	createProduct(name: string, description?: string): Promise<string>;
	createPrice(
		productId: string,
		price: number,
		currency: string,
		interval?: 'month' | 'year' | 'week' | 'day',
		intervalCount?: number
	): Promise<string>;
	createCustomer(email: string, name?: string): Promise<string>;
	createSubscription(
		customerId: string,
		priceId: string,
		trialDays?: number
	): Promise<PaymentSubscriptionDto>;
	cancelSubscription(
		subscriptionId: string,
		cancelAtPeriodEnd?: boolean
	): Promise<void>;
	createCheckoutSession(
		customerId: string,
		priceId: string,
		successUrl: string,
		cancelUrl: string
	): Promise<PaymentCheckoutSessionDto>;
	createCustomerPortalSession(
		customerId: string,
		returnUrl: string
	): Promise<{ url: string }>;
}

export interface PaymentSubscriptionDto {
	id: string;
	status: string;
	currentPeriodStart?: Date;
	currentPeriodEnd?: Date;
	trialStart?: Date;
	trialEnd?: Date;
	cancelAtPeriodEnd?: boolean;
}

export interface PaymentCheckoutSessionDto {
	id: string;
	url: string;
}
