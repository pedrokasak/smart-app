import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ComparisonModule } from 'src/comparison/comparison.module';
import { IntelligenceModule } from 'src/intelligence/intelligence.module';
import { MarketDataModule } from 'src/market-data/market-data.module';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import { RiIntelligenceModule } from 'src/ri-intelligence/ri-intelligence.module';
import { StockModule } from 'src/stocks/stocks.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { RagIngestionModule } from 'src/ai/rag-ingestion/rag-ingestion.module';
import { ChatHistoryModule } from 'src/ai/chat-history/chat-history.module';
import { AiController } from './ai.controller';
import { IntelligentChatService } from './intelligence/intelligent-chat.service';
import { CHAT_COST_OBSERVER } from './orchestration/chat-cost-observer.port';
import { CHAT_RESPONSE_CACHE } from './orchestration/chat-response-cache.port';
import { InMemoryChatResponseCacheAdapter } from './orchestration/infrastructure/in-memory-chat-response-cache.adapter';
import { LoggingChatCostObserverAdapter } from './orchestration/infrastructure/logging-chat-cost-observer.adapter';
import { TrackerrIaChatToolPlannerAdapter } from './orchestration/infrastructure/trackerr-ia-chat-tool-planner.adapter';
import { CHAT_TOOL_PLANNER } from './orchestration/tool-routing/chat-tool-planner.port';
import {
	CHAT_TOOL_ROUTER_CONFIG,
	loadChatToolRouterConfig,
} from './orchestration/tool-routing/chat-tool-router.config';
import { ChatToolRouterService } from './orchestration/tool-routing/chat-tool-router.service';
import { TrackerrIaRagSynthesizerAdapter } from './orchestration/infrastructure/trackerr-ia-rag-synthesizer.adapter';
import { CHAT_NARRATIVE_SYNTHESIZER } from './orchestration/chat-narrative-synthesizer.port';
import { ChatNarrativeSynthesisService } from './orchestration/chat-narrative-synthesis.service';
import { ChatOrchestratorService } from './orchestration/chat-orchestrator.service';
import { AiService } from './ai.service';
import { AiInsightProducer } from './events/ai-insight.producer';

@Module({
	imports: [
		HttpModule,
		PortfolioModule,
		MarketDataModule,
		ComparisonModule,
		IntelligenceModule,
		RiIntelligenceModule,
		StockModule,
		SubscriptionModule,
		RagIngestionModule,
		ChatHistoryModule,
	],
	controllers: [AiController],
	providers: [
		AiService,
		AiInsightProducer,
		IntelligentChatService,
		ChatOrchestratorService,
		InMemoryChatResponseCacheAdapter,
		LoggingChatCostObserverAdapter,
		ChatNarrativeSynthesisService,
		TrackerrIaRagSynthesizerAdapter,
		{
			provide: CHAT_NARRATIVE_SYNTHESIZER,
			useExisting: TrackerrIaRagSynthesizerAdapter,
		},
		{
			provide: CHAT_RESPONSE_CACHE,
			useExisting: InMemoryChatResponseCacheAdapter,
		},
		{
			provide: CHAT_COST_OBSERVER,
			useExisting: LoggingChatCostObserverAdapter,
		},
		// Roteador do chat com tool-calling (TRA-241).
		TrackerrIaChatToolPlannerAdapter,
		{
			provide: CHAT_TOOL_PLANNER,
			useExisting: TrackerrIaChatToolPlannerAdapter,
		},
		{
			provide: CHAT_TOOL_ROUTER_CONFIG,
			useFactory: () => loadChatToolRouterConfig(),
		},
		ChatToolRouterService,
	],
	exports: [AiService, IntelligentChatService, ChatOrchestratorService],
})
export class AiModule {}
