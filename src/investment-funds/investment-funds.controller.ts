import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { NotUserScoped } from 'src/auth/decorators/ownership.decorator';
import { InvestmentFundsService } from './application/investment-funds.service';
import { InvestmentFundSearchQueryDto } from './investment-funds.dto';

/**
 * Fundos de investimento (TRA-276): cadastro e cota diária vindos dos dados
 * abertos da CVM. Dado público, igual para todos — nada de usuário aqui.
 */
@Controller('investment-funds')
@ApiTags('investment-funds')
@ApiBearerAuth('access-token')
export class InvestmentFundsController {
	constructor(private readonly funds: InvestmentFundsService) {}

	@Get('search')
	@ApiResponse({
		status: 200,
		description:
			'Até 20 classes FIF do cadastro da CVM que casam com o nome ou o CNPJ, cada uma com a última cota (ou null) e a data dela',
	})
	async search(@Query() query: InvestmentFundSearchQueryDto) {
		return { funds: await this.funds.search(query.q) };
	}

	@Get(':cnpj')
	@NotUserScoped('cadastro público da CVM, igual para todos os usuários')
	@ApiResponse({ status: 200, description: 'Classe e última cota' })
	@ApiResponse({ status: 400, description: 'CNPJ inválido' })
	@ApiResponse({ status: 404, description: 'Fora do cadastro da CVM' })
	getFund(@Param('cnpj') cnpj: string) {
		return this.funds.getFund(cnpj);
	}
}
