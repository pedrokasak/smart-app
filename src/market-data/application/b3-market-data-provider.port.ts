import { MarketAssetSnapshot } from 'src/market-data/application/market-data-provider.port';

export interface B3MarketDataProviderPort {
	getAssetSnapshot(symbol: string): Promise<MarketAssetSnapshot | null>;
}

export const B3_MARKET_DATA_PROVIDER = Symbol('B3_MARKET_DATA_PROVIDER');

