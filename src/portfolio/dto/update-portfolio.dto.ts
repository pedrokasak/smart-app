import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsString, IsOptional, MaxLength } from 'class-validator';
import { CreatePortfolioDto } from 'src/portfolio/dto/create-portfolio.dto';

/**
 * Finalidade e política ficam fora da edição genérica: `updatePortfolio`
 * grava o corpo direto no documento, sem as regras da política (TRA-106).
 */
export class UpdatePortfolioDto extends PartialType(
	OmitType(CreatePortfolioDto, [
		'purpose',
		'policy',
		'inheritPrimaryPolicy',
	] as const)
) {
	@IsOptional()
	@IsString()
	@MaxLength(100)
	name?: string;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	description?: string;
}
