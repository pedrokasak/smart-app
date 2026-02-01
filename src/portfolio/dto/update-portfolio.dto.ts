import { PartialType } from '@nestjs/mapped-types';
import { IsString, IsOptional, MaxLength } from 'class-validator';
import { CreatePortfolioDto } from 'src/portfolio/dto/create-portfolio.dto';

export class UpdatePortfolioDto extends PartialType(CreatePortfolioDto) {
	@IsOptional()
	@IsString()
	@MaxLength(100)
	name?: string;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	description?: string;
}
