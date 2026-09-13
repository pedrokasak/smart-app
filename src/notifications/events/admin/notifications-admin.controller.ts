import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Role } from 'src/auth/enums/role.enum';
import { NotificationsService } from '../application/notifications.service';
import { ListNotificationsQueryDto } from '../dto/list-notifications-query.dto';

@Controller('admin/notifications')
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
export class NotificationsAdminController {
	constructor(private readonly notifications: NotificationsService) {}

	@Get()
	@Roles(Role.Admin)
	@ApiOperation({
		summary:
			'Lista as ultimas notificacoes disparadas para o usuario (suporte / auditoria)',
	})
	async list(@Query() query: ListNotificationsQueryDto) {
		const items = await this.notifications.listForUser(
			query.userId,
			query.limit ?? 50
		);
		return {
			userId: query.userId,
			count: items.length,
			items: items.map((n) => ({
				id: n._id?.toString(),
				type: n.type,
				dedupeKey: n.dedupeKey ?? null,
				payload: n.payload,
				deliveries: n.deliveries,
				createdAt: n.createdAt,
			})),
		};
	}
}
