export interface RiSummaryCacheEntry<T> {
	value: T;
	expiresAt: number | null;
}

export interface RiSummaryCachePort<T> {
	get(key: string): Promise<T | null>;
	set(key: string, value: T, ttlSeconds?: number): Promise<void>;
}

export const RI_SUMMARY_CACHE = Symbol('RI_SUMMARY_CACHE');
