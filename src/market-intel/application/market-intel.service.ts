import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
	MARKET_ANALYSIS_QUEUE,
	MARKET_FEED_FETCHER,
	MARKET_INGEST_RUN_STORE,
	MARKET_NEWS_STORE,
	MARKET_SOURCE_STORE,
	MARKET_STORY_STORE,
	MarketAnalysisQueue,
	MarketFeedFetcher,
	MarketIngestRunStore,
	MarketNewsStore,
	MarketSourceStore,
	MarketStoryStore,
} from './market-intel.ports';
import { MarketDeduplicator } from './market-deduplicator';
import { MarketStoryClusterer } from './market-story-clusterer';
import { MarketNewsItem, MarketStory } from 'src/market-intel/domain/market-intel.types';

const STORY_CANDIDATES_LIMIT = 500;

export interface IngestResult {
	sourcesTotal: number;
	sourcesFetched: number;
	sourcesFailed: number;
	itemsFound: number;
	itemsNew: number;
	itemsDuplicate: number;
	storiesCreated: number;
	storiesMerged: number;
	errors: string[];
}

@Injectable()
export class MarketIntelService {
	private readonly logger = new Logger(MarketIntelService.name);

	constructor(
		@Inject(MARKET_SOURCE_STORE) private readonly sourceStore: MarketSourceStore,
		@Inject(MARKET_NEWS_STORE) private readonly newsStore: MarketNewsStore,
		@Inject(MARKET_STORY_STORE) private readonly storyStore: MarketStoryStore,
		@Inject(MARKET_INGEST_RUN_STORE) private readonly runStore: MarketIngestRunStore,
		@Inject(MARKET_FEED_FETCHER) private readonly fetcher: MarketFeedFetcher,
		private readonly deduplicator: MarketDeduplicator,
		private readonly clusterer: MarketStoryClusterer,
		@Optional() @Inject(MARKET_ANALYSIS_QUEUE) private readonly queue?: MarketAnalysisQueue
	) {}

	async ingest(): Promise<IngestResult> {
		const sources = await this.sourceStore.findEnabled();
		const result: IngestResult = {
			sourcesTotal: sources.length,
			sourcesFetched: 0,
			sourcesFailed: 0,
			itemsFound: 0,
			itemsNew: 0,
			itemsDuplicate: 0,
			storiesCreated: 0,
			storiesMerged: 0,
			errors: [],
		};
		const runId = await this.runStore.start(new Date(), sources.length);
		const storyCandidates: MarketStory[] = await this.storyStore.findUnindexed(
			STORY_CANDIDATES_LIMIT
		);

		for (const source of sources) {
			try {
				const fetched = await this.fetcher.fetch(source);
				result.sourcesFetched++;

				await this.sourceStore.updateFetchMeta(source.id, {
					etag: fetched.etag,
					lastModified: fetched.lastModified,
					lastFetchedAt: new Date(),
				});

				if (!fetched.items) continue; // 304 Not Modified

				result.itemsFound += fetched.items.length;

				for (const raw of fetched.items) {
					if (!raw.url || !raw.title) continue;

					try {
						const dedup = await this.deduplicator.check(
							raw.url,
							raw.title,
							raw.description
						);

						if (dedup.isDuplicate) {
							result.itemsDuplicate++;
							continue;
						}

						const item: MarketNewsItem = {
							urlHash: dedup.urlHash,
							contentHash: dedup.contentHash,
							simHash: dedup.simHash,
							sourceId: source.id,
							layer: source.layer,
							title: raw.title.slice(0, 500),
							description: raw.description,
							url: raw.url,
							publishedAt: raw.publishedAt,
							author: raw.author,
							tokens: dedup.tokens,
							status: 'pending',
							storyId: null,
							discoveredAt: new Date(),
							analyzedAt: null,
							lastError: null,
						};

						await this.newsStore.insert(item);
						result.itemsNew++;

						const cluster = await this.clusterer.cluster(item, storyCandidates);
						await this.newsStore.assignStory(item.urlHash, cluster.storyId);

						if (cluster.isNew) {
							result.storiesCreated++;
							if (this.queue) {
								await this.queue.enqueue(cluster.storyId).catch((e) => {
									this.logger.warn(
										`Fila F2 indisponível para story ${cluster.storyId}: ${e instanceof Error ? e.message : String(e)}`
									);
								});
							}
						} else {
							result.storiesMerged++;
						}
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						this.logger.warn(
							`Item ignorado [${source.id}] ${raw.url}: ${msg}`
						);
					}
				}
			} catch (err) {
				result.sourcesFailed++;
				const msg = err instanceof Error ? err.message : String(err);
				this.logger.error(`Fonte falhou [${source.id}]: ${msg}`);
				result.errors.push(`[${source.id}] ${msg}`);
			}
		}

		await this.runStore.finish(runId, {
			sourcesFetched: result.sourcesFetched,
			sourcesFailed: result.sourcesFailed,
			itemsFound: result.itemsFound,
			itemsNew: result.itemsNew,
			itemsDuplicate: result.itemsDuplicate,
			storiesCreated: result.storiesCreated,
			storiesMerged: result.storiesMerged,
			errors: result.errors,
		});

		return result;
	}
}
