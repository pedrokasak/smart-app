import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
	ArrayMaxSize,
	IsArray,
	IsIn,
	IsNumber,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	Max,
	Min,
	ValidateNested,
} from 'class-validator';
import type { ComparisonRequest } from './application/comparison.types';
import {
	BANK_INSTRUMENT_KINDS,
	type BankInstrumentKind,
} from './domain/fixed-income-tax';
import { OFFER_INDEXERS, type OfferIndexer } from './domain/instrument';
import { COMPARISON_LIMITS } from './domain/limits';
import type { Offer } from './domain/offer';
import { TESOURO_ID_PATTERN } from './domain/tesouro-title';

/** Letras, números, espaço e pontuação comum: nada de quebra de linha ou marcação. */
const LABEL_PATTERN = /^[\p{L}\p{N} .,&+%/()'-]+$/u;

const finite = { allowNaN: false, allowInfinity: false } as const;

export class OfferDto implements Offer {
	@ApiProperty({ enum: BANK_INSTRUMENT_KINDS, example: 'CDB' })
	@IsIn(BANK_INSTRUMENT_KINDS)
	kind!: BankInstrumentKind;

	@ApiProperty({ enum: OFFER_INDEXERS, example: 'PERCENT_CDI' })
	@IsIn(OFFER_INDEXERS)
	indexer!: OfferIndexer;

	@ApiProperty({
		example: 110,
		description:
			'Depende do indexador: % do CDI, taxa a.a. (prefixado) ou juro real a.a. (IPCA+).',
	})
	@IsNumber(finite)
	@Min(0)
	@Max(300)
	ratePct!: number;

	@ApiPropertyOptional({ example: 'Banco X', description: 'Só para exibição.' })
	@IsOptional()
	@IsString()
	@MaxLength(COMPARISON_LIMITS.labelMaxLength)
	@Matches(LABEL_PATTERN, {
		message: 'label aceita letras, números, espaço e . , & + % / ( ) - apenas',
	})
	label?: string;
}

export class ComparisonRequestDto implements ComparisonRequest {
	@ApiProperty({ example: 10000, description: 'Valor aplicado, em R$.' })
	@IsNumber(finite)
	@Min(COMPARISON_LIMITS.principal.min)
	@Max(COMPARISON_LIMITS.principal.max)
	principal!: number;

	@ApiProperty({ example: 3, description: 'Prazo em anos (aceita fração).' })
	@IsNumber(finite)
	@Min(COMPARISON_LIMITS.years.min)
	@Max(COMPARISON_LIMITS.years.max)
	years!: number;

	@ApiPropertyOptional({
		example: 13.65,
		description: 'CDI em % a.a.; ausente = CDI de mercado (BACEN).',
	})
	@IsOptional()
	@IsNumber(finite)
	@Min(COMPARISON_LIMITS.cdiPct.min)
	@Max(COMPARISON_LIMITS.cdiPct.max)
	cdiPct?: number;

	@ApiPropertyOptional({
		example: 4.5,
		description: 'IPCA em % a.a.; ausente = IPCA de 12 meses (BACEN).',
	})
	@IsOptional()
	@IsNumber(finite)
	@Min(COMPARISON_LIMITS.ipcaPct.min)
	@Max(COMPARISON_LIMITS.ipcaPct.max)
	ipcaPct?: number;

	@ApiPropertyOptional({ type: [OfferDto] })
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(COMPARISON_LIMITS.maxOffers)
	@ValidateNested({ each: true })
	@Type(() => OfferDto)
	offers?: OfferDto[];

	@ApiPropertyOptional({
		example: ['IPCA_PLUS:2035-05-15'],
		description:
			'Títulos do Tesouro escolhidos; ausente = um por tipo, pelo prazo.',
	})
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(COMPARISON_LIMITS.maxTesouroIds)
	@Matches(TESOURO_ID_PATTERN, { each: true })
	tesouroIds?: string[];
}
