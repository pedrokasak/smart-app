import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Entrada do `/ai/simulate` legado (TRA-89). Mesma razão do
 * `AiChatRequestDto`: a rota aceitava `@Body() body: any` e repassava o
 * corpo inteiro adiante sem validação.
 *
 * Os tetos são generosos de propósito — não são regra de produto, só
 * impedem que valores absurdos virem laço de projeção caro do outro lado.
 */
export class AiSimulateRequestDto {
	@ApiProperty({ description: 'Aporte mensal' })
	@IsNumber()
	@Min(0)
	@Max(1_000_000_000)
	monthly_investment: number;

	@ApiProperty({ description: 'Horizonte em anos' })
	@IsNumber()
	@Min(0)
	@Max(100)
	years: number;

	@ApiProperty({ description: 'Valor atual da carteira' })
	@IsNumber()
	@Min(0)
	@Max(1_000_000_000_000)
	current_portfolio_value: number;

	@ApiPropertyOptional({ description: 'Retorno anual esperado (ex.: 0.10)' })
	@IsOptional()
	@IsNumber()
	@Min(-1)
	@Max(10)
	expected_annual_return?: number;
}
