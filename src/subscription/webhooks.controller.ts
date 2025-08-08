import { Controller, Post, Req, Res, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import Stripe from 'stripe';
import { WebhooksService } from './webhooks.service';
import { stripeWebhookSecret } from 'src/env';
import { Public } from 'src/utils/constants';

@Controller('webhooks')
export class WebhooksController {
	private readonly logger = new Logger(WebhooksController.name);
	private readonly stripe: Stripe;

	constructor(private webhooksService: WebhooksService) {
		this.stripe = new Stripe(process.env.STRIPE_PRIVATE_API_KEY, {
			apiVersion: '2025-06-30.basil',
		});
	}

	@Post('stripe')
	@Public()
	async handleStripeWebhook(@Req() req: Request, @Res() res: Response) {
		const sig = req.headers['stripe-signature'];
		const endpointSecret = stripeWebhookSecret;

		if (!endpointSecret) {
			this.logger.error('STRIPE_WEBHOOK_SECRET não configurado');
			return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
				error: 'Webhook secret não configurado',
			});
		}

		let event: Stripe.Event;

		try {
			// Verificar assinatura do webhook
			event = this.stripe.webhooks.constructEvent(
				req.body,
				sig as string,
				endpointSecret
			);
		} catch (err) {
			this.logger.error('Erro ao verificar assinatura do webhook:', err);
			return res.status(HttpStatus.BAD_REQUEST).json({
				error: 'Assinatura inválida',
			});
		}

		try {
			// Processar o webhook
			await this.webhooksService.handleWebhook(event);

			this.logger.log(`Webhook processado com sucesso: ${event.type}`);
			return res.status(HttpStatus.OK).json({ received: true });
		} catch (error) {
			this.logger.error('Erro ao processar webhook:', error);
			return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
				error: 'Erro interno do servidor',
			});
		}
	}
}
