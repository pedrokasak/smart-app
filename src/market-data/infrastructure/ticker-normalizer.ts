import { MarketAssetType } from 'src/market-data/application/market-data-provider.port';

const B3_ASSET_TYPES: ReadonlySet<MarketAssetType> = new Set([
	'stock',
	'fii',
	'etf',
	'fund',
]);

// B3 tickers typically follow patterns like PETR4, MXRF11, etc.
// (letters with digits at the end for share class)
const B3_TICKER_PATTERN = /^[A-Z]{2,4}\d{1,2}$/;

/**
 * Yahoo Finance requires a `.SA` suffix for B3-listed tickers (e.g. PETR4.SA).
 * B3 recognition relies on both asset type and ticker format heuristic.
 */
export function normalizeTickerForProvider(
	ticker: string,
	provider: 'yahoo',
	assetType: MarketAssetType
): string {
	const clean = String(ticker || '')
		.trim()
		.toUpperCase();

	if (provider !== 'yahoo') return clean;
	if (!B3_ASSET_TYPES.has(assetType)) return clean;
	if (clean.endsWith('.SA')) return clean;

	// Only append .SA if ticker matches B3 pattern
	if (!B3_TICKER_PATTERN.test(clean)) return clean;

	return `${clean}.SA`;
}
