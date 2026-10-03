import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enums/role.enum';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { RiWatchMetricsService } from '../application/ri-watch-metrics.service';

@Controller('admin/ri-watch')
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
export class RiWatchAdminController {
	constructor(private readonly metrics: RiWatchMetricsService) {}

	@Get('metrics')
	@Roles(Role.Admin)
	@ApiOperation({
		summary:
			'Vigia de RI: documentos processados, falhas e custo estimado (30 dias)',
	})
	getMetrics() {
		return this.metrics.overview();
	}
}
