import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { assetSchema } from 'src/assets/schema/assets.model';
import { portfolioSchema } from 'src/portfolio/schema/portfolio.model';
import { B3RegistryCnpjResolverAdapter } from 'src/ri-intelligence/infrastructure/b3-registry-cnpj-resolver.adapter';
import { CvmRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/cvm-ri-document-discovery.adapter';
import { RiIntelligenceModule } from 'src/ri-intelligence/ri-intelligence.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { FII_FILING_FEED } from './application/ports/fii-filing-feed.port';
import { FII_FUND_DIRECTORY } from './application/ports/fii-fund-directory.port';
import { HELD_TICKER_DIRECTORY } from './application/ports/held-ticker-directory.port';
import { ISSUER_CODE_DIRECTORY } from './application/ports/issuer-code-directory.port';
import { RI_DELIVERY_FEED } from './application/ports/ri-delivery-feed.port';
import { RI_HOLDER_DIRECTORY } from './application/ports/ri-holder-directory.port';
import { RI_SUMMARY_ENTITLEMENT } from './application/ports/ri-summary-entitlement.port';
import { RI_WATCH_DISCOVERY } from './application/ports/ri-watch-discovery.port';
import { RI_WATCH_METRICS_READER } from './application/ports/ri-watch-metrics.port';
import { RI_WATCH_STORE } from './application/ports/ri-watch-store.port';
import {
	loadRiWatchConfig,
	RI_WATCH_CONFIG,
} from './application/ri-watch.config';
import { RiWatchFiiScanner } from './application/ri-watch-fii.scanner';
import {
	loadCostPer1kTokensUsd,
	RI_WATCH_COST_PER_1K_TOKENS,
	RiWatchMetricsService,
} from './application/ri-watch-metrics.service';
import { RiWatchIndexer } from './application/ri-watch.indexer';
import { RiWatchNotifier } from './application/ri-watch.notifier';
import { RiWatchScheduler } from './application/ri-watch.scheduler';
import { RiWatchService } from './application/ri-watch.service';
import { CvmFiiRegistryAdapter } from './infrastructure/cvm-fii-registry.adapter';
import { EnetDeliveryFeedAdapter } from './infrastructure/enet-delivery-feed.adapter';
import { FundosNetFilingFeedAdapter } from './infrastructure/fundosnet-filing-feed.adapter';
import { MongoHeldTickerDirectory } from './infrastructure/mongo-held-ticker-directory';
import { MongoRiHolderDirectory } from './infrastructure/mongo-ri-holder-directory';
import { MongoRiWatchMetricsReader } from './infrastructure/mongo-ri-watch-metrics.reader';
import { MongoRiWatchRepository } from './infrastructure/mongo-ri-watch.repository';
import { RiWatchAdminController } from './admin/ri-watch-admin.controller';
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
 * Etapa D (TRA-264): acervo de RI do chat. Etapa E1 (TRA-266): FIIs.
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
		// FIIs (TRA-266): documentos pela FundosNet da B3, fundo pelo CNPJ do
		// informe mensal da CVM.
		CvmFiiRegistryAdapter,
		{ provide: FII_FUND_DIRECTORY, useExisting: CvmFiiRegistryAdapter },
		FundosNetFilingFeedAdapter,
		{ provide: FII_FILING_FEED, useExisting: FundosNetFilingFeedAdapter },
		RiWatchFiiScanner,
		// Aviso a quem tem o papel (TRA-261).
		MongoRiHolderDirectory,
		{ provide: RI_HOLDER_DIRECTORY, useExisting: MongoRiHolderDirectory },
		PlanRiSummaryEntitlement,
		{ provide: RI_SUMMARY_ENTITLEMENT, useExisting: PlanRiSummaryEntitlement },
		RiWatchNotifier,
		// Acervo de RI do chat (TRA-264), depois do aviso.
		RiWatchIndexer,
		RiWatchScheduler,
		// Painel admin (TRA-267): documentos, falhas e custo estimado.
		MongoRiWatchMetricsReader,
		{
			provide: RI_WATCH_METRICS_READER,
			useExisting: MongoRiWatchMetricsReader,
		},
		{
			provide: RI_WATCH_COST_PER_1K_TOKENS,
			useFactory: () => loadCostPer1kTokensUsd(),
		},
		RiWatchMetricsService,
	],
	controllers: [RiWatchAdminController],
})
export class RiWatchModule {}
