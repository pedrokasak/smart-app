import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ComparisonModule } from 'src/comparison/comparison.module';
import { IntelligenceModule } from 'src/intelligence/intelligence.module';
import { MarketDataModule } from 'src/market-data/market-data.module';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import { RiIntelligenceModule } from 'src/ri-intelligence/ri-intelligence.module';
import { AiController } from './ai.controller';
import { IntelligentChatService } from './intelligence/intelligent-chat.service';
import { CHAT_COST_OBSERVER } from './orchestration/chat-cost-observer.port';
import { CHAT_RESPONSE_CACHE } from './orchestration/chat-response-cache.port';
import { InMemoryChatResponseCacheAdapter } from './orchestration/infrastructure/in-memory-chat-response-cache.adapter';
import { NoopChatCostObserverAdapter } from './orchestration/infrastructure/noop-chat-cost-observer.adapter';
import { ChatOrchestratorService } from './orchestration/chat-orchestrator.service';
import { AiService } from './ai.service';

@Module({
	imports: [
		HttpModule,
		PortfolioModule,
		MarketDataModule,
		ComparisonModule,
		IntelligenceModule,
		RiIntelligenceModule,
	],
	controllers: [AiController],
	providers: [
		AiService,
		IntelligentChatService,
		ChatOrchestratorService,
		InMemoryChatResponseCacheAdapter,
		NoopChatCostObserverAdapter,
		{
			provide: CHAT_RESPONSE_CACHE,
			useExisting: InMemoryChatResponseCacheAdapter,
		},
		{
			provide: CHAT_COST_OBSERVER,
			useExisting: NoopChatCostObserverAdapter,
		},
	],
	exports: [AiService, IntelligentChatService, ChatOrchestratorService],
})
export class AiModule {}
