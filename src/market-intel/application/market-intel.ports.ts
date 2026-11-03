import {
	MarketIngestRun,
	MarketNewsItem,
	MarketSource,
	MarketStory,
} from 'src/market-intel/domain/market-intel.types';

// ── Store ports ───────────────────────────────────────────────────────────────

export const MARKET_SOURCE_STORE = Symbol('MARKET_SOURCE_STORE');

export interface MarketSourceStore {
	findAll(): Promise<MarketSource[]>;
	findEnabled(): Promise<MarketSource[]>;
	findById(id: string): Promise<MarketSource | null>;
	save(source: MarketSource): Promise<void>;
	updateFetchMeta(
		id: string,
		meta: { etag: string | null; lastModified: string | null; lastFetchedAt: Date }
	): Promise<void>;
}

export const MARKET_NEWS_STORE = Symbol('MARKET_NEWS_STORE');

export interface MarketNewsStore {
	existsByUrlHash(urlHash: string): Promise<boolean>;
	existsByContentHash(contentHash: string): Promise<boolean>;
	/** Busca itens publicados nas últimas `windowHours` horas para SimHash. */
	findRecentSimHashes(windowHours: number): Promise<{ urlHash: string; simHash: string }[]>;
	findPending(limit: number): Promise<MarketNewsItem[]>;
	insert(item: MarketNewsItem): Promise<void>;
	markDuplicate(urlHash: string): Promise<void>;
	assignStory(urlHash: string, storyId: string): Promise<void>;
	markAnalyzed(urlHash: string): Promise<void>;
	markFailed(urlHash: string, error: string): Promise<void>;
}

export const MARKET_STORY_STORE = Symbol('MARKET_STORY_STORE');

export interface MarketStoryStore {
	findBySeedHash(seedUrlHash: string): Promise<MarketStory | null>;
	findUnindexed(limit: number): Promise<MarketStory[]>;
	upsert(story: MarketStory): Promise<void>;
	markIndexed(seedUrlHash: string): Promise<void>;
}

export const MARKET_INGEST_RUN_STORE = Symbol('MARKET_INGEST_RUN_STORE');

export interface MarketIngestRunStore {
	start(startedAt: Date, sourcesTotal: number): Promise<string>;
	finish(
		id: string,
		result: Omit<MarketIngestRun, 'startedAt' | 'finishedAt' | 'sourcesTotal'>
	): Promise<void>;
}

// ── Feed fetcher port ─────────────────────────────────────────────────────────

export const MARKET_FEED_FETCHER = Symbol('MARKET_FEED_FETCHER');

export interface FeedItem {
	title: string;
	description: string;
	url: string;
	publishedAt: Date;
	author: string | null;
}

export interface FetchResult {
	/** null = feed não mudou (ETag/Last-Modified correspondeu). */
	items: FeedItem[] | null;
	etag: string | null;
	lastModified: string | null;
}

export interface MarketFeedFetcher {
	fetch(source: MarketSource): Promise<FetchResult>;
}

// ── Normalizer port ───────────────────────────────────────────────────────────

export const MARKET_URL_NORMALIZER = Symbol('MARKET_URL_NORMALIZER');

export interface MarketUrlNormalizer {
	/** URL canônica (lowercase, sem trailing slash, sem tracking params). */
	canonicalize(url: string): string;
	/** SHA-256 da URL canônica. */
	urlHash(canonicalUrl: string): string;
	/** SHA-256 do conteúdo normalizado (título + descrição). */
	contentHash(title: string, description: string): string;
	/** Tokeniza para SimHash. */
	tokenize(text: string): string[];
}

// ── Queue port (F2) ───────────────────────────────────────────────────────────

export const MARKET_ANALYSIS_QUEUE = Symbol('MARKET_ANALYSIS_QUEUE');

export interface MarketAnalysisQueue {
	enqueue(storyId: string): Promise<void>;
}
