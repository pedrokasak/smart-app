import {
	IsEnum,
	IsNumber,
	IsOptional,
	IsPositive,
	IsString,
	Min,
} from 'class-validator';

export class CreateAssetDto {
	@IsString()
	symbol: string; // VALE3, BTC, etc

	@IsOptional()
	@IsString()
	name?: string;

	@IsEnum(['stock', 'fii', 'crypto', 'etf', 'fund', 'investment_fund', 'other'])
	type:
		| 'stock'
		| 'fii'
		| 'crypto'
		| 'etf'
		| 'fund'
		| 'investment_fund'
		| 'other';

	@IsNumber()
	@Min(0.00001)
	quantity: number;

	// Positivo, sem piso de centavo: cota de fundo (TRA-276; 18 classes abaixo
	// de R$ 0,01 em 09/2026) e cripto de centavos têm preço unitário menor.
	@IsNumber()
	@IsPositive()
	price: number;
}
