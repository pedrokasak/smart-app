import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import {
	MACRO_SERIES_KEYS,
	type MacroSeriesKey,
} from './domain/series-catalog';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class MacroSeriesParamDto {
	@ApiProperty({ enum: MACRO_SERIES_KEYS, example: 'IPCA' })
	@IsIn(MACRO_SERIES_KEYS)
	key!: MacroSeriesKey;
}

export class MacroSeriesQueryDto {
	@ApiPropertyOptional({ example: '2025-01-01' })
	@IsOptional()
	@Matches(ISO_DATE, { message: 'from deve estar em YYYY-MM-DD' })
	from?: string;

	@ApiPropertyOptional({ example: '2025-12-31' })
	@IsOptional()
	@Matches(ISO_DATE, { message: 'to deve estar em YYYY-MM-DD' })
	to?: string;
}
