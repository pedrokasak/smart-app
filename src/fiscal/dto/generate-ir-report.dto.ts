import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsOptional, Matches } from 'class-validator';

export class GenerateIrReportDto {
	@ApiProperty({
		example: '2025',
		description: 'Ano-base para geração do relatório de IR',
	})
	@IsNumberString()
	@Matches(/^\d{4}$/, { message: 'year deve conter 4 dígitos' })
	year: string;

	@ApiPropertyOptional({
		example: 'json',
		description: 'Formato de retorno. Use pdf para download do relatório',
		enum: ['json', 'pdf'],
	})
	@IsOptional()
	@IsIn(['json', 'pdf'])
	format?: 'json' | 'pdf';
}
