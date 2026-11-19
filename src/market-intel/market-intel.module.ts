import { Module } from '@nestjs/common';
import { AgentControlModule } from 'src/agent-control/agent-control.module';
import { MarketDeduplicator } from './application/market-deduplicator';
import {
	MARKET_FEED_FETCHER,
	MARKET_INGEST_RUN_STORE,
	MARKET_NEWS_STORE,
	MARKET_SOURCE_STORE,
	MARKET_STORY_STORE,
	MARKET_URL_NORMALIZER,
} from './application/market-intel.ports';
import { MarketIntelScheduler } from './application/market-intel.scheduler';
import { MarketIntelService } from './application/market-intel.service';
import { MarketStoryClusterer } from './application/market-story-clusterer';
import { MongoMarketIngestRunStore } from './infrastructure/mongo-market-ingest-run.store';
import { MongoMarketNewsStore } from './infrastructure/mongo-market-news.store';
import { MongoMarketSourceStore } from './infrastructure/mongo-market-source.store';
import { MongoMarketStoryStore } from './infrastructure/mongo-market-story.store';
import { RssFeedAdapter } from './infrastructure/rss-feed.adapter';
import { MarketUrlNormalizerImpl } from './infrastructure/market-url-normalizer';
import { MarketSourcesSeeder } from './application/market-sources-seeder';

@Module({
	imports: [AgentControlModule],
	providers: [
		// Adapters de infraestrutura
		{ provide: MARKET_SOURCE_STORE, useClass: MongoMarketSourceStore },
		{ provide: MARKET_NEWS_STORE, useClass: MongoMarketNewsStore },
		{ provide: MARKET_STORY_STORE, useClass: MongoMarketStoryStore },
		{ provide: MARKET_INGEST_RUN_STORE, useClass: MongoMarketIngestRunStore },
		{ provide: MARKET_FEED_FETCHER, useClass: RssFeedAdapter },
		{ provide: MARKET_URL_NORMALIZER, useClass: MarketUrlNormalizerImpl },
		// Aplicação
		MarketDeduplicator,
		MarketStoryClusterer,
		MarketIntelService,
		MarketIntelScheduler,
		MarketSourcesSeeder,
	],
	exports: [MarketIntelService],
})
export class MarketIntelModule {}
