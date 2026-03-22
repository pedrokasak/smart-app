import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateAssetDto {
	@IsString()
	symbol: string; // VALE3, BTC, etc

	@IsOptional()
	@IsString()
	name?: string;

	@IsEnum(['stock', 'fii', 'crypto', 'etf', 'fund', 'other'])
	type: 'stock' | 'fii' | 'crypto' | 'etf' | 'fund' | 'other';

	@IsNumber()
	@Min(0.00001)
	quantity: number;

	@IsNumber()
	@Min(0.01)
	price: number;
}
