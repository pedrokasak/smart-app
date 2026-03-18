export class AssetResponseDto {
	id: string;
	portfolioId: string;
	symbol: string;
	type: 'stock' | 'fii' | 'crypto' | 'etf' | 'fund' | 'other';
	quantity: number;
	price: number;
	avgPrice?: number;
	total: number;
	currentPrice?: number;
	change24h?: number;
	dividendHistory?: { date: Date; value: number }[];
	indicators?: {
		dividendYield?: number;
		priceToEarnings?: number;
		roe?: number;
		marketCap?: number;
		volume?: number;
		pegRatio?: number;
		priceToBook?: number;
		currentYield?: number;
		pvpRatio?: number;
	};
	source: 'manual' | 'b3' | 'webscrape';
	lastEnrichedAt?: Date;
	createdAt: Date;
	updatedAt: Date;
}
