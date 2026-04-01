import { Injectable } from '@nestjs/common';
import {
	RiSummaryCacheEntry,
	RiSummaryCachePort,
} from 'src/ri-intelligence/application/ri-summary-cache.port';

@Injectable()
export class InMemoryRiSummaryCacheAdapter<T> implements RiSummaryCachePort<T> {
	private readonly store = new Map<string, RiSummaryCacheEntry<T>>();

	async get(key: string): Promise<T | null> {
		const entry = this.store.get(key);
		if (!entry) return null;
		if (entry.expiresAt && entry.expiresAt <= Date.now()) {
			this.store.delete(key);
			return null;
		}
		return entry.value;
	}

	async set(key: string, value: T, ttlSeconds = 0): Promise<void> {
		const ttl = Number(ttlSeconds || 0);
		const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : null;
		this.store.set(key, {
			value,
			expiresAt,
		});
	}
}
