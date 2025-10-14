import { IsString, IsUrl, IsOptional } from 'class-validator';

export class PaymentCheckoutSessionDto {
	@IsString()
	userId: string; // ID do usuário no seu sistema

	@IsString()
	subscriptionId: string; // ID do plano/assinatura no seu sistema

	@IsUrl()
	successUrl: string; // URL de redirecionamento após pagamento bem-sucedido

	@IsUrl()
	cancelUrl: string; // URL de redirecionamento se o usuário cancelar

	@IsOptional()
	@IsString()
	providerCustomerId?: string; // ID do cliente no provedor (Stripe, Asaas, etc)
}
