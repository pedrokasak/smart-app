import { Injectable } from '@nestjs/common';
import {
	ChatResponseCacheEntry,
	ChatResponseCachePort,
} from 'src/ai/orchestration/chat-response-cache.port';

@Injectable()
export class InMemoryChatResponseCacheAdapter<
	T,
> implements ChatResponseCachePort<T> {
	private readonly store = new Map<string, ChatResponseCacheEntry<T>>();

	async get(key: string): Promise<T | null> {
		const entry = this.store.get(key);
		if (!entry) return null;
		if (entry.expiresAt <= Date.now()) {
			this.store.delete(key);
			return null;
		}
		return entry.value;
	}

	async set(key: string, value: T, ttlSeconds: number): Promise<void> {
		const ttlMs = Math.max(Number(ttlSeconds || 0), 1) * 1000;
		this.store.set(key, {
			value,
			expiresAt: Date.now() + ttlMs,
		});
	}
}
