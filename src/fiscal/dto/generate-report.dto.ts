import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsOptional, Matches } from 'class-validator';

export class GenerateReportDto {
	@ApiProperty({
		example: 'fiscal',
		enum: ['fiscal', 'transactions', 'assets'],
	})
	@IsIn(['fiscal', 'transactions', 'assets'])
	type: 'fiscal' | 'transactions' | 'assets';

	@ApiPropertyOptional({
		example: '2025',
		description:
			'Ano base. Obrigatório para fiscal e transactions, opcional para assets.',
	})
	@IsOptional()
	@IsNumberString()
	@Matches(/^\d{4}$/, { message: 'year deve conter 4 dígitos' })
	year?: string;

	@ApiPropertyOptional({
		example: 'pdf',
		enum: ['json', 'pdf'],
	})
	@IsOptional()
	@IsIn(['json', 'pdf'])
	format?: 'json' | 'pdf';
}
