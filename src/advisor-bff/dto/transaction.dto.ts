import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import {
	AssetClass,
	Provenance,
	TransactionSide,
	TransactionSource,
} from 'src/advisor/domain/enums';
import type {
	Position,
	Transaction,
} from 'src/advisor/domain/portfolio.entities';
import type { DerivedPortfolio } from 'src/advisor/domain/positions';

/**
 * Só a estrutura é validada aqui; as regras (símbolo, datas, valores) são do
 * serviço, que responde 422 com `details.errors`.
 */
export class CreateTransactionDto {
	@ApiProperty({ example: 'PETR4' })
	@IsString()
	symbol: string;

	@ApiProperty({ enum: AssetClass })
	@IsEnum(AssetClass)
	assetClass: AssetClass;

	@ApiProperty({ enum: TransactionSide })
	@IsEnum(TransactionSide)
	side: TransactionSide;

	@ApiProperty({ example: 10 })
	@IsNumber()
	quantity: number;

	@ApiProperty({ description: 'Preço unitário em centavos', example: 3550 })
	@IsNumber()
	unitPriceMinor: number;

	@ApiProperty({ description: 'Taxas em centavos', example: 0 })
	@IsNumber()
	feesMinor: number;

	@ApiProperty({ example: 'BRL' })
	@IsString()
	currency: string;

	@ApiProperty({ description: 'AAAA-MM-DD', example: '2026-03-02' })
	@IsString()
	tradeDate: string;

	@ApiPropertyOptional({ description: 'Dias para liquidar a posição' })
	@IsOptional()
	@IsNumber()
	liquidityDays?: number;
}

export class TransactionResponseDto {
	@ApiProperty()
	id: string;

	@ApiProperty()
	symbol: string;

	@ApiProperty({ enum: AssetClass })
	assetClass: AssetClass;

	@ApiProperty({ enum: TransactionSide })
	side: TransactionSide;

	@ApiProperty()
	quantity: number;

	@ApiProperty()
	unitPriceMinor: number;

	@ApiProperty()
	feesMinor: number;

	@ApiProperty()
	currency: string;

	@ApiProperty({ description: 'AAAA-MM-DD' })
	tradeDate: string;

	@ApiPropertyOptional()
	liquidityDays?: number;

	@ApiProperty({ enum: Provenance })
	provenance: Provenance;

	@ApiProperty({ enum: TransactionSource })
	source: TransactionSource;

	@ApiPropertyOptional({ description: 'Lote de importação, se veio de CSV' })
	importBatchId?: string;

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string;

	static of(t: Transaction): TransactionResponseDto {
		return {
			id: t.id,
			symbol: t.symbol,
			assetClass: t.assetClass,
			side: t.side,
			quantity: t.quantity,
			unitPriceMinor: t.unitPriceMinor,
			feesMinor: t.feesMinor,
			currency: t.currency,
			tradeDate: t.tradeDate,
			...(t.liquidityDays !== undefined && { liquidityDays: t.liquidityDays }),
			provenance: t.provenance,
			source: t.source,
			...(t.importBatchId !== undefined && {
				importBatchId: t.importBatchId,
			}),
			createdAt: t.createdAt.toISOString(),
		};
	}
}

export class TransactionPageResponseDto {
	@ApiProperty({ type: [TransactionResponseDto] })
	items: TransactionResponseDto[];

	@ApiProperty({ type: String, nullable: true })
	nextCursor: string | null;
}

export class PositionResponseDto {
	@ApiProperty()
	symbol: string;

	@ApiProperty({ enum: AssetClass })
	assetClass: AssetClass;

	@ApiProperty()
	quantity: number;

	@ApiProperty({ description: 'Custo em centavos' })
	costMinor: number;

	@ApiProperty({ enum: Provenance })
	provenance: Provenance;

	@ApiPropertyOptional()
	liquidityDays?: number;

	static of(p: Position): PositionResponseDto {
		return {
			symbol: p.symbol,
			assetClass: p.assetClass,
			quantity: p.quantity,
			costMinor: p.costMinor,
			provenance: p.provenance,
			...(p.liquidityDays !== undefined && { liquidityDays: p.liquidityDays }),
		};
	}
}

export class PositionsResponseDto {
	@ApiProperty({ type: [PositionResponseDto] })
	positions: PositionResponseDto[];

	@ApiProperty({
		type: [String],
		description: 'Símbolos cujo livro é inconsistente (venda sem saldo)',
	})
	inconsistencies: string[];

	static of(derived: DerivedPortfolio): PositionsResponseDto {
		return {
			positions: derived.positions.map(PositionResponseDto.of),
			inconsistencies: derived.inconsistencies,
		};
	}
}
