export type TradeSide = 'buy' | 'sell';

export interface Trade {
	assetSymbol: string;
	side: TradeSide;
	quantity: number;
	price: number;
	fees?: number; // corretagem/emolumentos etc
	date: Date;
}

