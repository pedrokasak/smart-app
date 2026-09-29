import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import { RiWatchStore } from 'src/ri-intelligence/watch/application/ports/ri-watch-store.port';
import {
	RI_WATCH_FINISHED_STATUSES,
	RI_WATCH_MAX_ATTEMPTS,
	RiWatchDocument,
	RiWatchNotificationSnapshot,
	RiWatchSummarySnapshot,
	watchDocumentKey,
} from 'src/ri-intelligence/watch/domain/ri-watch';

/**
 * Store em memoria com a mesma semantica do repositorio Mongo, para os
 * specs do servico e do notificador do vigia (TRA-240, TRA-261).
 */
export class InMemoryRiWatchStore implements RiWatchStore {
	readonly docs = new Map<string, RiWatchDocument>();

	async registerNew(records: RiDocumentRecord[], now: Date) {
		let inserted = 0;
		for (const rec of records) {
			const key = watchDocumentKey(rec);
			if (!key || this.docs.has(key)) continue;
			this.docs.set(key, {
				key,
				ticker: rec.ticker,
				documentType: rec.documentType,
				publishedAt: rec.publishedAt,
				record: rec,
				status: 'pending',
				attempts: 0,
				discoveredAt: now.toISOString(),
				notifiedAt: null,
				notification: null,
				indexedAt: null,
			});
			inserted += 1;
		}
		return inserted;
	}

	async findPending(limit: number) {
		return [...this.docs.values()]
			.filter(
				(d) => d.status === 'pending' && d.attempts < RI_WATCH_MAX_ATTEMPTS
			)
			.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
			.slice(0, limit);
	}

	async markSummarized(key: string, summary: RiWatchSummarySnapshot) {
		Object.assign(this.docs.get(key)!, { status: 'summarized', summary });
	}

	async markSkipped(key: string, reason: string) {
		Object.assign(this.docs.get(key)!, {
			status: 'skipped',
			lastError: reason,
		});
	}

	async recordFailure(key: string, reason: string) {
		const doc = this.docs.get(key)!;
		doc.attempts += 1;
		doc.lastError = reason;
		if (doc.attempts >= RI_WATCH_MAX_ATTEMPTS) doc.status = 'failed';
	}

	async findUnnotified(limit: number, pendingSince: Date) {
		return [...this.docs.values()]
			.filter(
				(d) =>
					!d.notifiedAt &&
					(RI_WATCH_FINISHED_STATUSES.includes(d.status) ||
						(d.status === 'pending' &&
							new Date(d.discoveredAt).getTime() <= pendingSince.getTime()))
			)
			.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
			.slice(0, limit);
	}

	async findUnindexed(limit: number) {
		return [...this.docs.values()]
			.filter(
				(d) => RI_WATCH_FINISHED_STATUSES.includes(d.status) && !d.indexedAt
			)
			.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
			.slice(0, limit);
	}

	async markIndexed(key: string, now: Date) {
		Object.assign(this.docs.get(key)!, { indexedAt: now.toISOString() });
	}

	async markNotified(
		key: string,
		notification: RiWatchNotificationSnapshot,
		now: Date
	) {
		Object.assign(this.docs.get(key)!, {
			notifiedAt: now.toISOString(),
			notification,
		});
	}
}
