export interface SharedPortfolioSummaryDto {
	id: string;
	name: string;
}

export interface SharedHoldingDto {
	symbol: string;
	type: string;
	quantity: number;
	unitCost: number;
	source: 'manual' | 'b3' | 'webscrape';
}

export interface SharedTradeDto {
	symbol: string;
	side: 'buy' | 'sell';
	quantity: number;
	price: number;
	fees: number;
	/** YYYY-MM-DD, UTC. */
	date: string;
	imported: boolean;
	createdAt: Date;
}

export interface SharedPortfolioDto {
	id: string;
	name: string;
	holdings: SharedHoldingDto[];
	trades: SharedTradeDto[];
}
