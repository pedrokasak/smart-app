import {
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	Logger,
	Post,
	Req,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enums/role.enum';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import {
	DailyClosesJobService,
	DailyClosesOverview,
} from '../application/daily-closes-job.service';

@Controller('admin/market-data/daily-closes')
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
export class DailyClosesAdminController {
	private readonly logger = new Logger(DailyClosesAdminController.name);

	constructor(private readonly job: DailyClosesJobService) {}

	@Get()
	@Roles(Role.Admin)
	@ApiOperation({
		summary:
			'Histórico diário de preços (COTAHIST): cotações guardadas, último pregão e resultado da última rodada',
	})
	overview(): Promise<DailyClosesOverview> {
		return this.job.overview();
	}

	/**
	 * Roda agora, fora das 22h. Pode baixar arquivos anuais da B3 (dezenas de
	 * MB cada): responde na hora e roda em segundo plano. O log guarda quem
	 * pediu (auditoria, CLAUDE.md §4.3).
	 */
	@Post('run')
	@Roles(Role.Admin)
	@HttpCode(HttpStatus.ACCEPTED)
	@ApiOperation({ summary: 'Baixa o COTAHIST e recalcula os betas agora' })
	run(@Req() req: { user?: { userId?: string } }) {
		if (this.job.isRunning) return { status: 'already_running' };
		this.logger.log(
			`Histórico diário disparado manualmente pelo admin ${req.user?.userId ?? 'desconhecido'}`
		);
		void this.job.run();
		return { status: 'started' };
	}
}
