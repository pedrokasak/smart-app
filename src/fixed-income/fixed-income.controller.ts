import {
	Body,
	Controller,
	Get,
	HttpCode,
	Post,
	ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequiresCapability } from 'src/subscription/capabilities/requires-capability.decorator';
import { MarketRateUnavailableError } from './application/comparison.types';
import { FixedIncomeComparisonService } from './application/fixed-income-comparison.service';
import { FixedIncomeRatesService } from './application/fixed-income-rates.service';
import { FixedIncomeVerdictService } from './application/fixed-income-verdict.service';
import { REGRESSIVE_TAX_BRACKETS } from './domain/fixed-income-tax';
import { COMPARISON_LIMITS } from './domain/limits';
import { OFFER_RATE_BOUNDS } from './domain/offer';
import { ComparisonRequestDto } from './fixed-income.dto';

/** Tabela do IR para a tela exibir; a última faixa (sem teto) vai como `null`. */
const TAX_BRACKETS = REGRESSIVE_TAX_BRACKETS.map((bracket) => ({
	upToDays: Number.isFinite(bracket.upToDays) ? bracket.upToDays : null,
	ratePct: bracket.ratePct,
}));

/**
 * Comparador de renda fixa (TRA-269): taxas oficiais, cálculo no server e
 * veredito. Nada aqui é dado de usuário — taxas e títulos são públicos e
 * iguais para todos.
 */
@Controller('fixed-income')
@ApiTags('fixed-income')
@ApiBearerAuth('access-token')
export class FixedIncomeController {
	constructor(
		private readonly rates: FixedIncomeRatesService,
		private readonly comparison: FixedIncomeComparisonService,
		private readonly verdict: FixedIncomeVerdictService
	) {}

	@Get('rates')
	@ApiResponse({
		status: 200,
		description:
			'CDI, Selic meta, IPCA 12 meses e títulos do Tesouro Direto, cada um com data e fonte (fonte indisponível vem como null), mais a tabela regressiva do IR e os limites de entrada.',
	})
	async getRates() {
		return {
			...(await this.rates.getRates()),
			taxBrackets: TAX_BRACKETS,
			limits: { ...COMPARISON_LIMITS, offerRate: OFFER_RATE_BOUNDS },
		};
	}

	@Post('comparison')
	@HttpCode(200)
	@ApiResponse({
		status: 200,
		description: 'Tabela comparativa e leitura do cenário',
	})
	@ApiResponse({ status: 400, description: 'Parâmetro inválido' })
	@ApiResponse({
		status: 503,
		description: 'CDI ou IPCA sem leitura de mercado e sem valor informado',
	})
	compare(@Body() dto: ComparisonRequestDto) {
		return this.unavailableAs503(() => this.comparison.compare(dto));
	}

	/**
	 * Mesmo gate do comparador de ativos: cada veredito pode custar uma
	 * chamada de LLM, e o texto de regra já vem em `comparison.analysis`.
	 */
	@Post('comparison/verdict')
	@HttpCode(200)
	@RequiresCapability('research.comparator')
	@ApiResponse({
		status: 200,
		description: 'Veredito em prosa; `source` diz se veio da IA ou das regras',
	})
	@ApiResponse({ status: 403, description: 'Plano sem o comparador' })
	getVerdict(@Body() dto: ComparisonRequestDto) {
		return this.unavailableAs503(() => this.verdict.verdict(dto));
	}

	private async unavailableAs503<T>(run: () => Promise<T>): Promise<T> {
		try {
			return await run();
		} catch (error) {
			if (error instanceof MarketRateUnavailableError) {
				throw new ServiceUnavailableException({
					error: 'MARKET_RATE_UNAVAILABLE',
					field: error.field,
					message: error.message,
				});
			}
			throw error;
		}
	}
}
