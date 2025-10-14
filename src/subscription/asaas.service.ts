import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { asaasApiKey, asaasUrlSandbox } from 'src/env';

@Injectable()
export class AsaasService {
	private readonly baseUrl = asaasUrlSandbox;

	constructor(private readonly httpService: HttpService) {}

	private getHeaders() {
		const apiKey = asaasApiKey;
		if (!apiKey) throw new Error('ASAAS_API_KEY não definida');
		return {
			headers: {
				accept: 'application/json',
				'Content-Type': 'application/json',
				access_token: apiKey,
			},
		};
	}

	async createCustomer(name: string, email: string) {
		const response = await firstValueFrom(
			this.httpService.post(
				`${this.baseUrl}/customers`,
				{ name, email },
				this.getHeaders()
			)
		);
		return response.data;
	}

	async getCustomer(id: string) {
		const response = await firstValueFrom(
			this.httpService.get(`${this.baseUrl}/customers/${id}`, this.getHeaders())
		);
		return response.data;
	}

	async createSubscription(
		customerId: string,
		value: number,
		billingType: 'CREDIT_CARD' | 'BOLETO' | 'PIX' = 'CREDIT_CARD',
		dueDate?: string,
		cycle:
			| 'WEEKLY'
			| 'BIWEEKLY'
			| 'MONTHLY'
			| 'QUARTERLY'
			| 'SEMIANNUALLY'
			| 'YEARLY' = 'MONTHLY',
		trialDays?: number
	) {
		const payload = {
			customer: customerId,
			billingType,
			nextDueDate: dueDate || new Date().toISOString().split('T')[0],
			value,
			cycle,
			description: 'Assinatura automática via Trakker',
			discount: trialDays
				? {
						value: value,
						dueDateLimitDays: trialDays,
					}
				: undefined,
		};

		const response = await firstValueFrom(
			this.httpService.post(
				`${this.baseUrl}/subscriptions`,
				payload,
				this.getHeaders()
			)
		);

		return response.data;
	}

	async cancelSubscription(subscriptionId: string) {
		const response = await firstValueFrom(
			this.httpService.delete(
				`${this.baseUrl}/subscriptions/${subscriptionId}`,
				this.getHeaders()
			)
		);
		return response.data;
	}

	async createPayment(
		customerId: string,
		value: number,
		billingType: 'CREDIT_CARD' | 'BOLETO' | 'PIX' = 'CREDIT_CARD',
		dueDate?: string
	) {
		const payload = {
			customer: customerId,
			billingType,
			value,
			dueDate: dueDate || new Date().toISOString().split('T')[0],
		};

		const response = await firstValueFrom(
			this.httpService.post(
				`${this.baseUrl}/payments`,
				payload,
				this.getHeaders()
			)
		);

		return response.data;
	}
}
