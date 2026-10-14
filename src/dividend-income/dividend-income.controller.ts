import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { DividendIncomeService } from './application/dividend-income.service';
import { DividendIncomeQueryDto } from './dto/dividend-income-query.dto';

/** O payload do JWT variou entre versões; aceita as formas já emitidas. */
function resolveUserId(req: any): string {
	return String(
		req?.user?.userId ?? req?.user?.sub ?? req?.user?._id ?? req?.user?.id ?? ''
	);
}

/**
 * Como a renda de proventos pode crescer (docs/requisitos/ia-didatica.md,
 * RF-8). Dois segmentos de caminho de propósito: `GET /portfolio/:id` não
 * captura esta rota.
 */
@Controller('portfolio/dividend-income')
@ApiTags('Portfolio Dividend Income')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class DividendIncomeController {
	constructor(private readonly dividendIncome: DividendIncomeService) {}

	@Get('insight')
	@ApiResponse({
		status: 200,
		description:
			'Renda de proventos de 12 meses, maiores pagadores, efeito do reinvestimento, sinais de yield inflado e efeito na meta do plano, com a explicação por nível.',
	})
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	insight(@Req() req: any, @Query() query: DividendIncomeQueryDto) {
		return this.dividendIncome.insight(resolveUserId(req), query);
	}
}
