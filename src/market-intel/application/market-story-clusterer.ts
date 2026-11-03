import { Inject, Injectable } from '@nestjs/common';
import {
	MARKET_STORY_STORE,
	MarketStoryStore,
} from './market-intel.ports';
import { MarketNewsItem, MarketStory } from 'src/market-intel/domain/market-intel.types';
import { hammingDistance } from 'src/market-intel/infrastructure/market-url-normalizer';

const SIMHASH_HAMMING_THRESHOLD = 3;
const WINDOW_MS = 48 * 60 * 60 * 1000;

export interface ClusterResult {
	storyId: string;
	isNew: boolean;
}

/**
 * Clusteriza um item de notícia em uma story existente ou cria nova.
 *
 * Busca stories recentes (não-indexadas) e compara SimHash com o seed.
 * Hamming ≤ 3 dentro da janela de 48h = mesmo evento (ADR-004).
 */
@Injectable()
export class MarketStoryClusterer {
	constructor(
		@Inject(MARKET_STORY_STORE) private readonly storyStore: MarketStoryStore
	) {}

	async cluster(item: MarketNewsItem): Promise<ClusterResult> {
		const itemSimHash = BigInt(item.simHash);

		const candidates = await this.storyStore.findUnindexed(200);

		for (const story of candidates) {
			const ageDiff = Math.abs(
				item.publishedAt.getTime() - story.latestAt.getTime()
			);
			if (ageDiff > WINDOW_MS) continue;

			const seedSimHash = BigInt(story.seedSimHash);
			if (hammingDistance(itemSimHash, seedSimHash) <= SIMHASH_HAMMING_THRESHOLD) {
				const updated: MarketStory = {
					...story,
					memberUrlHashes: [...story.memberUrlHashes, item.urlHash],
					latestAt:
						item.publishedAt > story.latestAt ? item.publishedAt : story.latestAt,
					earliestAt:
						item.publishedAt < story.earliestAt ? item.publishedAt : story.earliestAt,
				};
				await this.storyStore.upsert(updated);
				return { storyId: story.seedUrlHash, isNew: false };
			}
		}

		const newStory: MarketStory = {
			seedUrlHash: item.urlHash,
			seedSimHash: item.simHash,
			title: item.title,
			memberUrlHashes: [item.urlHash],
			latestAt: item.publishedAt,
			earliestAt: item.publishedAt,
			indexedAt: null,
		};
		await this.storyStore.upsert(newStory);
		return { storyId: item.urlHash, isNew: true };
	}
}
