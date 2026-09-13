import {
	Controller,
	Get,
	Param,
	Patch,
	Query,
	Req,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { InAppNotificationsService } from './application/in-app-notifications.service';
import { ListInAppNotificationsQueryDto } from './dto/list-in-app-notifications-query.dto';
import {
	InAppNotificationItem,
	InAppNotificationPage,
} from './domain/in-app-notification.types';

/** O payload do JWT variou entre versoes; aceita as formas ja emitidas. */
function resolveUserId(req: any): string {
	return String(
		req?.user?.userId ?? req?.user?.sub ?? req?.user?._id ?? req?.user?.id ?? ''
	);
}

/**
 * Centro de notificacoes do usuario final (TRA-136).
 *
 * Nao confundir com `NotificationsAdminController`: la o admin informa o
 * `userId` na query; aqui o dono sai exclusivamente do JWT e nenhuma rota
 * aceita um id de usuario vindo do cliente.
 *
 * O `JwtAuthGuard` ja e global (APP_GUARD), mas fica explicito aqui para
 * que a protecao nao dependa de configuracao a distancia.
 */
@Controller('notifications')
@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class InAppNotificationsController {
	constructor(private readonly service: InAppNotificationsService) {}

	@Get()
	@ApiOperation({
		summary:
			'Lista as notificacoes do usuario autenticado (mais recentes primeiro)',
	})
	async list(
		@Req() req: any,
		@Query() query: ListInAppNotificationsQueryDto
	): Promise<InAppNotificationPage> {
		return this.service.list(resolveUserId(req), {
			limit: query.limit,
			cursor: query.cursor,
			unreadOnly: query.unreadOnly,
		});
	}

	@Get('unread-count')
	@ApiOperation({ summary: 'Contagem de nao lidas para o badge do sino' })
	async unreadCount(@Req() req: any): Promise<{ unreadCount: number }> {
		return this.service.unreadCount(resolveUserId(req));
	}

	/**
	 * Declarada antes de `:id/read` nao por necessidade (os paths nao
	 * colidem), e sim por leitura: as duas rotas de escrita ficam juntas.
	 */
	@Patch('read-all')
	@ApiOperation({ summary: 'Marca todas as nao lidas do usuario como lidas' })
	async markAllAsRead(@Req() req: any): Promise<{ updated: number }> {
		return this.service.markAllAsRead(resolveUserId(req));
	}

	@Patch(':id/read')
	@ApiOperation({
		summary:
			'Marca uma notificacao como lida (idempotente; 404 se nao for do usuario)',
	})
	async markAsRead(
		@Req() req: any,
		@Param('id') id: string
	): Promise<InAppNotificationItem> {
		return this.service.markAsRead(resolveUserId(req), id);
	}
}
