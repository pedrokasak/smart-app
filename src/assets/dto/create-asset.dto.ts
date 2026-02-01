import { IsEnum, IsNumber, IsString, Min } from 'class-validator';

export class CreateAssetDto {
	@IsString()
	symbol: string; // VALE3, BTC, etc

	@IsEnum(['stock', 'fii', 'crypto', 'etf', 'fund'])
	type: 'stock' | 'fii' | 'crypto' | 'etf' | 'fund';

	@IsNumber()
	@Min(0.00001)
	quantity: number;

	@IsNumber()
	@Min(0.01)
	price: number;
}
