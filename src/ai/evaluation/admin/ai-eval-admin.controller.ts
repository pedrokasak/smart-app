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
import { AiEvalOverview, AiEvalService } from '../application/ai-eval.service';

@Controller('admin/ai-evals')
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
export class AiEvalAdminController {
	private readonly logger = new Logger(AiEvalAdminController.name);

	constructor(private readonly evaluation: AiEvalService) {}

	@Get('latest')
	@Roles(Role.Admin)
	@ApiOperation({
		summary:
			'Último relatório da avaliação de IA (notas por rota e intenção, guardrail e regressões), o anterior na mesma rubrica e se há rodada em andamento',
	})
	latest(): Promise<AiEvalOverview> {
		return this.evaluation.overview();
	}

	/**
	 * Roda agora, fora da segunda-feira. Leva minutos (uma nota de juiz por
	 * amostra): responde na hora e roda em segundo plano. Cada rodada custa
	 * LLM, então o log guarda quem pediu (auditoria, CLAUDE.md §4.3).
	 */
	@Post('run')
	@Roles(Role.Admin)
	@HttpCode(HttpStatus.ACCEPTED)
	@ApiOperation({ summary: 'Dispara a avaliação de IA agora' })
	run(@Req() req: { user?: { userId?: string } }) {
		if (this.evaluation.isRunning) return { status: 'already_running' };
		this.logger.log(
			`Avaliação de IA disparada manualmente pelo admin ${req.user?.userId ?? 'desconhecido'}`
		);
		void this.evaluation
			.run()
			.catch((err) =>
				this.logger.error(
					`Avaliação de IA (manual) falhou: ${err instanceof Error ? err.message : String(err)}`
				)
			);
		return { status: 'started' };
	}
}
