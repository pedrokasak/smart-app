import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class InvestmentFundSearchQueryDto {
	@ApiProperty({
		description: 'Parte do nome da classe ou do CNPJ (com ou sem máscara)',
		example: 'itau multimercado',
	})
	@IsString()
	@MinLength(2)
	@MaxLength(80)
	q!: string;
}
