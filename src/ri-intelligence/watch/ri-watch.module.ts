import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { assetSchema } from 'src/assets/schema/assets.model';
import { portfolioSchema } from 'src/portfolio/schema/portfolio.model';
import { B3RegistryCnpjResolverAdapter } from 'src/ri-intelligence/infrastructure/b3-registry-cnpj-resolver.adapter';
import { CvmRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/cvm-ri-document-discovery.adapter';
import { RiIntelligenceModule } from 'src/ri-intelligence/ri-intelligence.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { HELD_TICKER_DIRECTORY } from './application/ports/held-ticker-directory.port';
import { ISSUER_CODE_DIRECTORY } from './application/ports/issuer-code-directory.port';
import { RI_DELIVERY_FEED } from './application/ports/ri-delivery-feed.port';
import { RI_HOLDER_DIRECTORY } from './application/ports/ri-holder-directory.port';
import { RI_SUMMARY_ENTITLEMENT } from './application/ports/ri-summary-entitlement.port';
import { RI_WATCH_DISCOVERY } from './application/ports/ri-watch-discovery.port';
import { RI_WATCH_STORE } from './application/ports/ri-watch-store.port';
import {
	loadRiWatchConfig,
	RI_WATCH_CONFIG,
} from './application/ri-watch.config';
import { RiWatchIndexer } from './application/ri-watch.indexer';
import { RiWatchNotifier } from './application/ri-watch.notifier';
import { RiWatchScheduler } from './application/ri-watch.scheduler';
import { RiWatchService } from './application/ri-watch.service';
import { EnetDeliveryFeedAdapter } from './infrastructure/enet-delivery-feed.adapter';
import { MongoHeldTickerDirectory } from './infrastructure/mongo-held-ticker-directory';
import { MongoRiHolderDirectory } from './infrastructure/mongo-ri-holder-directory';
import { MongoRiWatchRepository } from './infrastructure/mongo-ri-watch.repository';
import { PlanRiSummaryEntitlement } from './infrastructure/plan-ri-summary-entitlement';
import { RiWatchDocumentModel } from './infrastructure/ri-watch-document.model';

/**
 * Vigia de RI (TRA-240), etapa 1: descobrir documentos novos dos tickers em
 * carteira e pre-gerar o resumo verificado.
 *
 * Modulo proprio, e nao mais uma pasta de providers dentro do
 * `RiIntelligenceModule`: a dependencia so anda num sentido — o vigia usa a
 * descoberta, o conteudo e o resumo do RI; o RI nao sabe que o vigia existe.
 * Etapa C (TRA-261): avisa quem tem o papel, publicando no barramento de
 * eventos (global); o plano de cada detentor vem do `SubscriptionModule`.
 * A proxima etapa (acervo no RAG) entra aqui.
 *
 * Asset e Portfolio sao registrados localmente (mesmo schema; o Mongoose
 * deduplica por nome, entao nao ha colecao paralela).
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'RiWatchDocument', schema: RiWatchDocumentModel.schema },
			{ name: 'Asset', schema: assetSchema },
			{ name: 'Portfolio', schema: portfolioSchema },
		]),
		HttpModule,
		RiIntelligenceModule,
		SubscriptionModule,
	],
	providers: [
		MongoRiWatchRepository,
		{ provide: RI_WATCH_STORE, useExisting: MongoRiWatchRepository },
		MongoHeldTickerDirectory,
		{ provide: HELD_TICKER_DIRECTORY, useExisting: MongoHeldTickerDirectory },
		// So a fonte oficial: ver `ri-watch-discovery.port.ts`.
		{ provide: RI_WATCH_DISCOVERY, useExisting: CvmRiDocumentDiscoveryAdapter },
		// Fonte diaria (TRA-260): consulta do ENET, casada com a carteira pelo
		// codigo CVM do registro da B3 — a mesma instancia (e o mesmo cache de
		// 24h) que a descoberta ja usa para o CNPJ.
		EnetDeliveryFeedAdapter,
		{ provide: RI_DELIVERY_FEED, useExisting: EnetDeliveryFeedAdapter },
		{
			provide: ISSUER_CODE_DIRECTORY,
			useExisting: B3RegistryCnpjResolverAdapter,
		},
		{ provide: RI_WATCH_CONFIG, useFactory: () => loadRiWatchConfig() },
		RiWatchService,
		// Aviso a quem tem o papel (TRA-261).
		MongoRiHolderDirectory,
		{ provide: RI_HOLDER_DIRECTORY, useExisting: MongoRiHolderDirectory },
		PlanRiSummaryEntitlement,
		{ provide: RI_SUMMARY_ENTITLEMENT, useExisting: PlanRiSummaryEntitlement },
		RiWatchNotifier,
		// Acervo de RI do chat (TRA-264), depois do aviso.
		RiWatchIndexer,
		RiWatchScheduler,
	],
})
export class RiWatchModule {}
