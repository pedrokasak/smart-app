import {
	Controller,
	ForbiddenException,
	Get,
	Req,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { CohortBenchmarkService } from 'src/benchmark/application/cohort-benchmark.service';

function requireUserId(req: any): string {
	const userId =
		req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
	if (!userId) throw new ForbiddenException('Usuário não autenticado.');
	return String(userId);
}

/**
 * "Você × investidores do seu perfil" (ADR-003, TRA-60). A rota só conhece o
 * usuário do token e devolve o agregado da coorte dele; não existe variante
 * por id.
 */
@Controller('benchmark')
@ApiTags('Benchmark')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class BenchmarkController {
	constructor(private readonly service: CohortBenchmarkService) {}

	@Get('cohort')
	@ApiOperation({
		summary: 'Compara o seu Score e retorno com o agregado do seu perfil',
	})
	cohort(@Req() req: any) {
		return this.service.getForUser(requireUserId(req));
	}
}
