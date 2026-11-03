import { Inject, Injectable } from '@nestjs/common';
import {
	MARKET_NEWS_STORE,
	MarketNewsStore,
	MARKET_URL_NORMALIZER,
	MarketUrlNormalizer,
} from './market-intel.ports';
import {
	computeSimHash,
	hammingDistance,
} from 'src/market-intel/infrastructure/market-url-normalizer';

const SIMHASH_WINDOW_HOURS = 48;
const SIMHASH_HAMMING_THRESHOLD = 3;

export interface DeduplicationResult {
	isDuplicate: boolean;
	reason: 'url' | 'content' | 'simhash' | null;
	urlHash: string;
	contentHash: string;
	simHash: string;
	tokens: string[];
}

/**
 * Deduplicação em 3 níveis (ADR-004 seção 7):
 * 1. urlHash — mesma URL canônica
 * 2. contentHash — mesmo conteúdo normalizado
 * 3. SimHash — conteúdo muito similar (Hamming ≤ 3, janela 48h)
 */
@Injectable()
export class MarketDeduplicator {
	constructor(
		@Inject(MARKET_NEWS_STORE) private readonly newsStore: MarketNewsStore,
		@Inject(MARKET_URL_NORMALIZER) private readonly normalizer: MarketUrlNormalizer
	) {}

	async check(
		url: string,
		title: string,
		description: string
	): Promise<DeduplicationResult> {
		const canonical = this.normalizer.canonicalize(url);
		const urlHash = this.normalizer.urlHash(canonical);
		const contentHash = this.normalizer.contentHash(title, description);
		const tokens = this.normalizer.tokenize(title + ' ' + description);
		const simHashBigInt = computeSimHash(tokens);
		const simHash = simHashBigInt.toString();

		// Nível 1: URL
		if (await this.newsStore.existsByUrlHash(urlHash)) {
			return { isDuplicate: true, reason: 'url', urlHash, contentHash, simHash, tokens };
		}

		// Nível 2: conteúdo
		if (await this.newsStore.existsByContentHash(contentHash)) {
			return { isDuplicate: true, reason: 'content', urlHash, contentHash, simHash, tokens };
		}

		// Nível 3: SimHash na janela de 48h
		const recentHashes = await this.newsStore.findRecentSimHashes(SIMHASH_WINDOW_HOURS);
		for (const { simHash: existingSimHash } of recentHashes) {
			const existing = BigInt(existingSimHash);
			if (hammingDistance(simHashBigInt, existing) <= SIMHASH_HAMMING_THRESHOLD) {
				return { isDuplicate: true, reason: 'simhash', urlHash, contentHash, simHash, tokens };
			}
		}

		return { isDuplicate: false, reason: null, urlHash, contentHash, simHash, tokens };
	}
}
