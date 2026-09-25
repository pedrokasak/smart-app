import {
	BadRequestException,
	Body,
	Controller,
	Headers,
	HttpCode,
	Inject,
	Logger,
	Post,
	ServiceUnavailableException,
	UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { Public } from 'src/utils/constants';
import { PixPaymentConfirmationService } from './application/pix-payment-confirmation.service';

/** Token esperado no header `asaas-access-token` (vem de ASAAS_WEBHOOK_TOKEN). */
export const ASAAS_WEBHOOK_TOKEN = Symbol('ASAAS_WEBHOOK_TOKEN');

/** Compara em tempo constante; tamanhos diferentes já são falso. */
export function tokensMatch(received: unknown, expected: string): boolean {
	if (typeof received !== 'string' || !received || !expected) return false;
	const a = Buffer.from(received);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Webhook do Asaas (TRA-195).
 *
 * `@Public()` porque quem chama é o Asaas, não um usuário — o `JwtAuthGuard`
 * global barraria. A autenticação é o token que o Asaas envia no header
 * `asaas-access-token`, configurado no painel dele e em `ASAAS_WEBHOOK_TOKEN`.
 * Sem o token configurado a rota recusa tudo: webhook aberto liberaria plano
 * pago para qualquer um que soubesse um id de cobrança.
 */
@ApiExcludeController()
@Controller('webhooks')
export class AsaasWebhookController {
	private readonly logger = new Logger(AsaasWebhookController.name);

	constructor(
		private readonly confirmation: PixPaymentConfirmationService,
		@Inject(ASAAS_WEBHOOK_TOKEN) private readonly expectedToken: string
	) {}

	@Public()
	@Post('asaas')
	@HttpCode(200)
	async handle(
		@Headers('asaas-access-token') token: string | undefined,
		@Body() body: any
	) {
		if (!this.expectedToken) {
			this.logger.error(
				'Webhook do Asaas recebido sem ASAAS_WEBHOOK_TOKEN configurado — recusado.'
			);
			throw new ServiceUnavailableException('Webhook não configurado.');
		}
		if (!tokensMatch(token, this.expectedToken)) {
			throw new UnauthorizedException('Token de webhook inválido.');
		}

		const event = typeof body?.event === 'string' ? body.event : null;
		const paymentId =
			typeof body?.payment?.id === 'string' ? body.payment.id : null;
		if (!event) throw new BadRequestException('Evento ausente.');
		// Eventos que não são de cobrança (ex.: transferência) não interessam.
		if (!paymentId) return { received: true, outcome: 'ignored' };

		const outcome = await this.confirmation.handle({
			event,
			payment: {
				id: paymentId,
				value: Number(body.payment.value),
				paymentDate: body.payment.paymentDate ?? null,
			},
		});
		return { received: true, outcome };
	}
}
