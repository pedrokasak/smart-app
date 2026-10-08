export class AssetResponseDto {
	id: string;
	portfolioId: string;
	symbol: string;
	name?: string;
	/** Setor econômico; `null` quando desconhecido ou não aplicável (TRA-144). */
	sector?: string | null;
	type:
		| 'stock'
		| 'fii'
		| 'crypto'
		| 'etf'
		| 'fund'
		| 'investment_fund'
		| 'other';
	quantity: number;
	price: number;
	avgPrice?: number;
	total: number;
	currentPrice?: number;
	/** Quando a cotação foi lida na fonte (TRA-247). */
	currentPriceAt?: Date;
	/** Data da cotação usada na marcação a mercado, em ISO (TRA-247). */
	quoteAsOf?: string;
	/** Fonte da cotação usada (`primary`, `fallback_fundamentus`...). */
	quoteSource?: string;
	change24h?: number;
	dividendHistory?: {
		date: Date;
		value: number;
		paymentType?: 'JCP' | 'DIVIDEND' | 'RENDIMENTO' | 'OTHER';
	}[];
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
		beta?: number;
	};
	/** Ativo usado como mercado no beta (`indicators.beta`), TRA-251. */
	betaBenchmark?: string;
	/** Último pregão usado no cálculo do beta, YYYY-MM-DD. */
	betaAsOf?: string;
	signal?: string;
	source: 'manual' | 'b3' | 'webscrape';
	lastEnrichedAt?: Date;
	createdAt: Date;
	updatedAt: Date;
}
