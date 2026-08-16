export type FundamentalKey =
	| 'roic'
	| 'netMargin'
	| 'netDebt'
	| 'payout'
	| 'priceEarnings'
	| 'priceToBook'
	| 'evEbitda'
	| 'returnOnEquity';

export type FundamentalSource = 'brapi' | 'fundamentus' | 'yahoo' | 'derived';

export type FundamentalStatus = 'ok' | 'unavailable' | 'not_applicable';

export interface FundamentalValue {
	status: FundamentalStatus;
	value: number | null;
	source: FundamentalSource | null;
}

export interface FundamentalsResult {
	symbol: string;
	sector: string | null;
	mixed: boolean;
	values: Record<FundamentalKey, FundamentalValue>;
}

export const FUNDAMENTAL_KEYS: readonly FundamentalKey[] = [
	'roic',
	'netMargin',
	'netDebt',
	'payout',
	'priceEarnings',
	'priceToBook',
	'evEbitda',
	'returnOnEquity',
];
