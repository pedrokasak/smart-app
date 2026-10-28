import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
	IsMongoId,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsPositive,
	IsString,
	Max,
} from 'class-validator';
import { ASSET_PRICE_MAX } from 'src/assets/dto/create-asset.dto';

const FINITE = { allowNaN: false, allowInfinity: false };

// Cripto de centavos chega a bilhões de unidades; acima disso é erro de digitação.
export const SALE_QUANTITY_MAX = 1e12;

export class SalePreviewDto {
	@ApiProperty({ example: 'PETR4' })
	@IsString()
	@IsNotEmpty()
	symbol: string;

	@ApiProperty({ example: 100, maximum: SALE_QUANTITY_MAX })
	@IsNumber(FINITE)
	@IsPositive()
	@Max(SALE_QUANTITY_MAX)
	quantity: number;

	@ApiProperty({
		example: 38.5,
		description: 'Preço unitário de venda, em R$.',
		maximum: ASSET_PRICE_MAX,
	})
	@IsNumber(FINITE)
	@IsPositive()
	@Max(ASSET_PRICE_MAX)
	sellPrice: number;

	@ApiPropertyOptional({
		description:
			'Carteira da posição; ausente = todas as carteiras do usuário.',
	})
	@IsOptional()
	@IsMongoId()
	portfolioId?: string;
}
