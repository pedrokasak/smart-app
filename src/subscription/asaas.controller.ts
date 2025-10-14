// @Controller('asaas')
// export class AsaasController {
// 	constructor(private readonly asaasService: AsaasService) {}

// 	@Post('customers')
// 	async createCustomer(@Body() body: { name: string; email: string }) {
// 		return this.asaasService.createCustomer(body.name, body.email);
// 	}

// 	@Get('customers/:id')
// 	async getCustomer(@Param('id') id: string) {
// 		return this.asaasService.getCustomer(id);
// 	}

// 	@Post('subscriptions')
// 	async createSubscription(
// 		@Body()
// 		body: {
// 			customerId: string;
// 			value: number;
// 			billingType?: 'CREDIT_CARD' | 'BOLETO' | 'PIX';
// 			dueDate?: string;
// 			cycle?:
// 				| 'WEEKLY'
// 				| 'BIWEEKLY'
// 				| 'MONTHLY'
// 				| 'QUARTERLY'
// 				| 'SEMIANNUALLY'
// 				| 'YEARLY';
// 			trialDays?: number;
// 		}
// 	) {
// 		return this.asaasService.createSubscription(
// 			body.customerId,
// 			body.planId,
// 			body.value,
// 			body.trialDays
// 		);
// 	}

// 	@Delete('subscriptions/:id')
// 	async cancelSubscription(@Param('id') id: string) {
// 		return this.asaasService.cancelSubscription(id);
// 	}

// 	@Post('payments')
// 	async createPayment(
// 		@Body()
// 		body: {
// 			customerId: string;
// 			value: number;
// 			billingType?: 'CREDIT_CARD' | 'BOLETO' | 'PIX';
// 			dueDate?: string;
// 		}
// 	) {
// 		return this.asaasService.createPayment(
// 			body.customerId,
// 			body.value,
// 			body.billingType,
// 			body.dueDate
// 		);
// 	}
// }
