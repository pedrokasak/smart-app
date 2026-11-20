import { ApiProperty } from '@nestjs/swagger';
import {
	ArrayMaxSize,
	ArrayMinSize,
	ArrayUnique,
	IsArray,
	IsString,
	MaxLength,
} from 'class-validator';

export const MAX_SHARED_PORTFOLIOS = 50;
export const MAX_PORTFOLIO_ID_LENGTH = 64;

/** Opaque B2C portfolio ids; ownership is checked by the service. */
export class PortfolioIdsDto {
	@ApiProperty({
		type: [String],
		minItems: 1,
		maxItems: MAX_SHARED_PORTFOLIOS,
		uniqueItems: true,
	})
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(MAX_SHARED_PORTFOLIOS)
	@ArrayUnique()
	@IsString({ each: true })
	@MaxLength(MAX_PORTFOLIO_ID_LENGTH, { each: true })
	portfolioIds: string[];
}

export class ChangeSharedPortfoliosDto extends PortfolioIdsDto {}
