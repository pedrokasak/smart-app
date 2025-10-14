// @Injectable()
// export class AsaasAdapter implements PaymentProviderAdapter {
// 	constructor(private readonly asaasService: AsaasService) {}

// 	async createProduct(name: string, description?: string): Promise<string> {
// 		// Asaas não tem produto, simulamos um ID
// 		return name.toLowerCase().replace(/\s+/g, '-');
// 	}

// 	async createPrice(): Promise<string> {
// 		return 'asaas-inline-price';
// 	}

// 	async createCustomer(email: string, name?: string): Promise<string> {
// 		const customer = await this.asaasService.createCustomer(
// 			name || 'Usuário',
// 			email
// 		);
// 		return customer.id;
// 	}

// 	async createSubscription(
// 		customerId: string,
// 		priceId: string,
// 		trialDays?: number
// 	): Promise<PaymentSubscriptionDto> {
// 		const subscription = await this.asaasService.createSubscription(
// 			customerId,
// 			Number(priceId),
// 			'CREDIT_CARD',
// 			undefined,
// 			'MONTHLY',
// 			trialDays
// 		);

// 		return {
// 			name: subscription.name,
// 			id: subscription.id,
// 			status: subscription.status,
// 			currentPeriodStart: new Date(subscription.currentDueDate),
// 			currentPeriodEnd: new Date(subscription.nextDueDate),
// 			trialStart: trialDays ? new Date() : undefined,
// 			trialEnd: trialDays
// 				? new Date(Date.now() + trialDays * 86400000)
// 				: undefined,
// 			cancelAtPeriodEnd: false,
// 		};
// 	}

// 	async cancelSubscription(subscriptionId: string): Promise<void> {
// 		await this.asaasService.cancelSubscription(subscriptionId);
// 	}

// 	async createCheckoutSession(
// 		customerId: string,
// 		priceId: string,
// 		successUrl: string
// 	): Promise<PaymentCheckoutSessionDto> {
// 		const payment = await this.asaasService.createPayment(
// 			customerId,
// 			Number(priceId)
// 		);
// 		return { id: payment.id, url: payment.invoiceUrl || successUrl };
// 	}

// 	async createCustomerPortalSession(
// 		customerId: string,
// 		returnUrl: string
// 	): Promise<{ url: string }> {
// 		// Asaas não tem portal nativo, então simulamos
// 		return { url: `${returnUrl}?customer=${customerId}` };
// 	}
// }
