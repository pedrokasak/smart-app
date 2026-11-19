import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { PortfolioPolicyService } from './application/portfolio-policy.service';

/** O payload do JWT variou entre versões; aceita as formas já emitidas. */
function resolveUserId(req: any): string {
	return String(
		req?.user?.userId ?? req?.user?.sub ?? req?.user?._id ?? req?.user?.id ?? ''
	);
}

/**
 * Finalidades e políticas sugeridas do assistente "Nova carteira" (TRA-106).
 * Dois segmentos de caminho: `GET /portfolio/:id` não captura esta rota.
 */
@Controller('portfolio/policy')
@ApiTags('Portfolio Policy')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class PortfolioPolicyController {
	constructor(private readonly portfolioPolicy: PortfolioPolicyService) {}

	@Get('suggestions')
	@ApiResponse({
		status: 200,
		description:
			'Finalidades de carteira com a política sugerida de cada uma, e a política da carteira principal do usuário (ou null).',
	})
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	suggestions(@Req() req: any) {
		return this.portfolioPolicy.suggestions(resolveUserId(req));
	}
}
