import { Type } from 'class-transformer';
import {
	IsArray,
	IsBoolean,
	IsNumber,
	IsObject,
	IsOptional,
	IsString,
	ValidateNested,
} from 'class-validator';

class OpportunityRadarFiscalContextDto {
	@IsOptional()
	@IsBoolean()
	hasCompensableLoss?: boolean;

	@IsOptional()
	@IsNumber()
	estimatedTaxOnNextSell?: number | null;
}

class OpportunityRadarRulesDto {
	@IsOptional()
	@IsNumber()
	maxPriceToEarnings?: number;

	@IsOptional()
	@IsNumber()
	minDividendYield?: number;

	@IsOptional()
	@IsNumber()
	maxDipChangePercent?: number;

	@IsOptional()
	@IsNumber()
	underallocationTolerancePct?: number;

	@IsOptional()
	@IsNumber()
	maxSignalsTotal?: number;

	@IsOptional()
	@IsObject()
	maxSignalsPerKind?: Partial<
		Record<'risk' | 'opportunity' | 'fiscal' | 'rebalance', number>
	>;
}

/**
 * Corpo do POST /ai/opportunity-radar (TRA-8). Todos os campos sao
 * opcionais: sem `candidateSymbols`/`watchlistSymbols`, o radar roda so
 * sobre a carteira do usuario autenticado e as regras padrao do
 * `OpportunityRadarService`.
 */
export class OpportunityRadarRequestDto {
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	candidateSymbols?: string[];

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	watchlistSymbols?: string[];

	@IsOptional()
	@IsObject()
	sectorTargetAllocation?: Record<string, number>;

	@IsOptional()
	@ValidateNested()
	@Type(() => OpportunityRadarRulesDto)
	rules?: OpportunityRadarRulesDto;

	@IsOptional()
	@ValidateNested()
	@Type(() => OpportunityRadarFiscalContextDto)
	fiscalContext?: OpportunityRadarFiscalContextDto;
}
