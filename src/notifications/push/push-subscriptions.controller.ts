import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Post,
	Req,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { PushSubscriptionsService } from './application/push-subscriptions.service';
import {
	RegisterPushSubscriptionDto,
	UnregisterPushSubscriptionDto,
} from './dto/register-push-subscription.dto';

/** O payload do JWT variou entre versoes; aceita as formas ja emitidas. */
function resolveUserId(req: any): string {
	return String(
		req?.user?.userId ?? req?.user?.sub ?? req?.user?._id ?? req?.user?.id ?? ''
	);
}

/**
 * Assinaturas Web Push do usuario autenticado (TRA-136, fase 6).
 *
 * Nenhuma rota aceita id de usuario do cliente e nenhuma resposta devolve
 * `keys` — o material criptografico entra e nao sai.
 *
 * O `JwtAuthGuard` ja e global (APP_GUARD), mas fica explicito aqui para
 * que a protecao nao dependa de configuracao a distancia.
 */
@Controller('notifications/push')
@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class PushSubscriptionsController {
	constructor(private readonly service: PushSubscriptionsService) {}

	@Get('vapid-public-key')
	@ApiOperation({
		summary: 'Chave publica VAPID usada pelo navegador para criar a assinatura',
	})
	vapidPublicKey(): { publicKey: string } {
		return this.service.vapidPublicKey();
	}

	@Post('subscriptions')
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({
		summary: 'Registra a assinatura do navegador (idempotente por endpoint)',
	})
	async register(
		@Req() req: any,
		@Body() body: RegisterPushSubscriptionDto
	): Promise<{ registered: true }> {
		return this.service.register(resolveUserId(req), {
			endpoint: body.endpoint,
			keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
			// Origem: header do proprio request, nunca campo do corpo. Serve
			// so para o usuario reconhecer o aparelho numa tela futura de
			// "dispositivos conectados".
			userAgent: readUserAgent(req),
		});
	}

	@Delete('subscriptions')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary:
			'Remove a assinatura do usuario (idempotente: endpoint desconhecido tambem devolve 200)',
	})
	async unregister(
		@Req() req: any,
		@Body() body: UnregisterPushSubscriptionDto
	): Promise<{ removed: boolean }> {
		return this.service.unregister(resolveUserId(req), body.endpoint);
	}
}

function readUserAgent(req: any): string | null {
	const raw = req?.headers?.['user-agent'];
	if (typeof raw !== 'string' || !raw.trim()) return null;
	return raw.slice(0, 255);
}
