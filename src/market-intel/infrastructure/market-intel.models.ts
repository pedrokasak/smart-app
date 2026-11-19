import { Schema, model } from 'mongoose';
import {
	MarketIngestRun,
	MarketNewsItem,
	MarketSource,
	MarketStory,
	NewsItemStatus,
	SourceLayer,
} from 'src/market-intel/domain/market-intel.types';

// ── MarketSource ──────────────────────────────────────────────────────────────

const marketSourceSchema = new Schema<MarketSource>(
	{
		id: { type: String, required: true },
		name: { type: String, required: true },
		feedUrl: { type: String, required: true },
		layer: { type: String, required: true, enum: ['A', 'B'] as SourceLayer[] },
		enabled: { type: Boolean, required: true, default: true },
		domain: { type: String, required: true },
		lastFetchedAt: { type: Date, default: null },
		etag: { type: String, default: null },
		lastModified: { type: String, default: null },
	},
	{ timestamps: true, collection: 'market_sources', minimize: false }
);

marketSourceSchema.index({ id: 1 }, { unique: true, name: 'market_source_id' });
marketSourceSchema.index({ enabled: 1 }, { name: 'market_source_enabled' });

export const MarketSourceModel = model<MarketSource>(
	'MarketSource',
	marketSourceSchema
);

// ── MarketNewsItem ────────────────────────────────────────────────────────────

const marketNewsItemSchema = new Schema<MarketNewsItem>(
	{
		urlHash: { type: String, required: true },
		contentHash: { type: String, required: true },
		simHash: { type: String, required: true },
		sourceId: { type: String, required: true },
		layer: { type: String, required: true, enum: ['A', 'B'] as SourceLayer[] },
		title: { type: String, required: true },
		description: { type: String, required: true, default: '' },
		url: { type: String, required: true },
		publishedAt: { type: Date, required: true },
		author: { type: String, default: null },
		tokens: { type: [String], required: true, default: [] },
		status: {
			type: String,
			required: true,
			enum: [
				'pending',
				'analyzed',
				'skipped',
				'failed',
				'duplicate',
			] as NewsItemStatus[],
			default: 'pending',
		},
		storyId: { type: String, default: null },
		discoveredAt: { type: Date, required: true },
		analyzedAt: { type: Date, default: null },
		lastError: { type: String, default: null },
	},
	{ timestamps: true, collection: 'market_news_items', minimize: false }
);

// Dedup primário por URL
marketNewsItemSchema.index(
	{ urlHash: 1 },
	{ unique: true, name: 'market_news_url_hash' }
);
// Dedup secundário por conteúdo
marketNewsItemSchema.index(
	{ contentHash: 1 },
	{ name: 'market_news_content_hash' }
);
// Fila de pendentes — mais recentes primeiro
marketNewsItemSchema.index(
	{ status: 1, publishedAt: -1 },
	{ name: 'market_news_pending' }
);
// Busca por similaridade SimHash (janela 48h)
marketNewsItemSchema.index(
	{ publishedAt: -1, simHash: 1 },
	{ name: 'market_news_simhash_window' }
);
// Por story
marketNewsItemSchema.index(
	{ storyId: 1 },
	{ sparse: true, name: 'market_news_story' }
);

export const MarketNewsItemModel = model<MarketNewsItem>(
	'MarketNewsItem',
	marketNewsItemSchema
);

// ── MarketStory ───────────────────────────────────────────────────────────────

const marketStorySchema = new Schema<MarketStory>(
	{
		seedUrlHash: { type: String, required: true },
		seedSimHash: { type: String, required: true },
		title: { type: String, required: true },
		memberUrlHashes: { type: [String], required: true, default: [] },
		latestAt: { type: Date, required: true },
		earliestAt: { type: Date, required: true },
		indexedAt: { type: Date, default: null },
	},
	{ timestamps: true, collection: 'market_stories', minimize: false }
);

marketStorySchema.index(
	{ seedUrlHash: 1 },
	{ unique: true, name: 'market_story_seed' }
);
// Fila de não-indexadas — mais recentes primeiro
marketStorySchema.index(
	{ indexedAt: 1, latestAt: -1 },
	{ name: 'market_story_unindexed' }
);

export const MarketStoryModel = model<MarketStory>(
	'MarketStory',
	marketStorySchema
);

// ── MarketIngestRun ───────────────────────────────────────────────────────────

const marketIngestRunSchema = new Schema<MarketIngestRun>(
	{
		startedAt: { type: Date, required: true },
		finishedAt: { type: Date, default: null },
		sourcesTotal: { type: Number, required: true, default: 0 },
		sourcesFetched: { type: Number, required: true, default: 0 },
		sourcesFailed: { type: Number, required: true, default: 0 },
		itemsFound: { type: Number, required: true, default: 0 },
		itemsNew: { type: Number, required: true, default: 0 },
		itemsDuplicate: { type: Number, required: true, default: 0 },
		storiesCreated: { type: Number, required: true, default: 0 },
		storiesMerged: { type: Number, required: true, default: 0 },
		errors: { type: [String], required: true, default: [] },
	},
	{ timestamps: true, collection: 'market_ingest_runs', minimize: false }
);

marketIngestRunSchema.index(
	{ startedAt: -1 },
	{ name: 'market_ingest_run_started' }
);

export const MarketIngestRunModel = model<MarketIngestRun>(
	'MarketIngestRun',
	marketIngestRunSchema
);
