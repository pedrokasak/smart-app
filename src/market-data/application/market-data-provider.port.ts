export type MarketAssetType =
	| 'stock'
	| 'fii'
	| 'crypto'
	| 'etf'
	| 'fund'
	| 'other';

export interface MarketAssetSnapshot {
	symbol: string;
	assetType: MarketAssetType;
	sector: string | null;
	price: number | null;
	dividendYield: number | null;
	performance: {
		changePercent: number | null;
	};
	fundamentals: {
		priceToEarnings: number | null;
		priceToBook: number | null;
		returnOnEquity: number | null;
		netMargin: number | null;
		evEbitda: number | null;
		marketCap: number | null;
	};
	metadata: {
		source: 'primary' | 'fallback_fundamentus';
		fallbackUsed: boolean;
		partial: boolean;
		fallbackSources: string[];
	};
}

export interface MarketDataProviderPort {
	getAssetSnapshot(symbol: string): Promise<MarketAssetSnapshot | null>;
	getManyAssetSnapshots(symbols: string[]): Promise<MarketAssetSnapshot[]>;
}

export const MARKET_DATA_PROVIDER = Symbol('MARKET_DATA_PROVIDER');
