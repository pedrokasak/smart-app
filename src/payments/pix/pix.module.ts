import { Logger, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
	asaasApiKey,
	asaasApiUrl,
	asaasWebhookToken,
	pixCheckoutEnabled,
} from 'src/env';
import {
	SubscriptionModel,
	UserSubscriptionModel,
} from 'src/subscription/schema';
import { UserModel } from 'src/users/schema/user.model';
import { PixCheckoutService } from './application/pix-checkout.service';
import { PIX_GATEWAY, PixGatewayPort } from './application/pix-gateway.port';
import { PixPaymentConfirmationService } from './application/pix-payment-confirmation.service';
import {
	ASAAS_WEBHOOK_TOKEN,
	AsaasWebhookController,
} from './asaas-webhook.controller';
import { AsaasPixGateway } from './infrastructure/asaas-pix.gateway';
import { DisabledPixGateway } from './infrastructure/disabled-pix.gateway';
import { pixChargeSchema } from './infrastructure/pix-charge.model';
import { PixController } from './pix.controller';

/** Placeholders que já apareceram nos `.env` — nenhum é chave do Asaas. */
const PLACEHOLDER_KEYS = new Set(['', 'test-key', 'changeme', 'your-key']);

export interface PixGatewayConfig {
	enabled: boolean;
	apiKey?: string;
	baseUrl?: string;
	nodeEnv?: string;
}

/**
 * Decide se o checkout PIX sobe ligado. Três travas, nesta ordem:
 *
 * 1. `PIX_CHECKOUT_ENABLED=true` explícito. Ter chave no ambiente não basta:
 *    hoje produção tem uma chave de SANDBOX configurada, e ligar por presença
 *    de chave exporia a cliente real um QR que banco nenhum paga.
 * 2. Chave real (não placeholder de `.env`).
 * 3. Em produção, recusa URL de sandbox — mesmo motivo do item 1.
 */
export function createPixGateway(
	config: PixGatewayConfig = {
		enabled: pixCheckoutEnabled,
		apiKey: asaasApiKey,
		baseUrl: asaasApiUrl,
		nodeEnv: process.env.NODE_ENV,
	}
): PixGatewayPort {
	const key = String(config.apiKey ?? '').trim();
	if (!config.enabled || PLACEHOLDER_KEYS.has(key) || !config.baseUrl) {
		return new DisabledPixGateway();
	}
	if (config.nodeEnv === 'production' && /sandbox/i.test(config.baseUrl)) {
		new Logger('PixModule').error(
			'PIX_CHECKOUT_ENABLED=true em produção apontando para o SANDBOX do ' +
				'Asaas — checkout PIX mantido desligado. Configure ASAAS_API_URL e ' +
				'ASAAS_API_KEY de produção.'
		);
		return new DisabledPixGateway();
	}
	return new AsaasPixGateway({ apiKey: key, baseUrl: config.baseUrl });
}

/**
 * Pagamento por PIX via Asaas (TRA-195). Módulo isolado: o Stripe continua
 * dono do cartão; este módulo só emite cobrança PIX e, no webhook, libera o
 * período pago na mesma `UserSubscription` que o resto do app já lê.
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'PixCharge', schema: pixChargeSchema },
			{ name: 'Subscription', schema: SubscriptionModel.schema },
			{ name: 'UserSubscription', schema: UserSubscriptionModel.schema },
			{ name: 'User', schema: UserModel.schema },
		]),
	],
	controllers: [PixController, AsaasWebhookController],
	providers: [
		{ provide: PIX_GATEWAY, useFactory: () => createPixGateway() },
		{ provide: ASAAS_WEBHOOK_TOKEN, useValue: asaasWebhookToken ?? '' },
		PixCheckoutService,
		PixPaymentConfirmationService,
	],
})
export class PixModule {}
