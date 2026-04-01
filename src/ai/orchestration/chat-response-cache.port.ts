export interface ChatResponseCacheEntry<T> {
	value: T;
	expiresAt: number;
}

export interface ChatResponseCachePort<T> {
	get(key: string): Promise<T | null>;
	set(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export const CHAT_RESPONSE_CACHE = Symbol('CHAT_RESPONSE_CACHE');
