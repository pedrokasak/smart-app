import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { UserModel } from 'src/users/schema/user.model';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import { IntelligenceModule } from 'src/intelligence/intelligence.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { RagFactBuilderService } from 'src/ai/rag-ingestion/application/rag-fact-builder.service';
import { RagIngestionScheduler } from 'src/ai/rag-ingestion/application/rag-ingestion.scheduler';
import { RagColdStartService } from 'src/ai/rag-ingestion/application/rag-cold-start.service';
import { RAG_INGESTION } from 'src/ai/rag-ingestion/application/rag-ingestion.port';
import { TrackerrIaRagIngestionAdapter } from 'src/ai/rag-ingestion/infrastructure/trackerr-ia-rag-ingestion.adapter';

@Module({
	imports: [
		HttpModule,
		MongooseModule.forFeature([{ name: 'User', schema: UserModel.schema }]),
		PortfolioModule,
		IntelligenceModule,
		SubscriptionModule,
	],
	providers: [
		RagFactBuilderService,
		RagIngestionScheduler,
		RagColdStartService,
		TrackerrIaRagIngestionAdapter,
		{
			provide: RAG_INGESTION,
			useExisting: TrackerrIaRagIngestionAdapter,
		},
	],
	exports: [RagFactBuilderService, RagColdStartService],
})
export class RagIngestionModule {}
