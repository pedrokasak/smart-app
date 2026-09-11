import { HttpModule } from '@nestjs/axios';
import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssetsModule } from 'src/assets/assets.module';
import { AssetAdapterFactory } from 'src/portfolio/adapter/asset-adapter.factory';
import { BrapiStockAdapter } from 'src/portfolio/adapter/brapi.adapter';
import { CoinGeckoAdapter } from 'src/portfolio/adapter/coingecko.adapter';
import { FiisApiAdapter } from 'src/portfolio/adapter/fiis-adapter';
import { TwelveDataEtfAdapter } from 'src/portfolio/adapter/twelvedata.adapter';
import { MarketDataModule } from 'src/market-data/market-data.module';
import { PortfolioEnrichService } from 'src/portfolio/portfolio-enrich.service';
import { PortfolioController } from 'src/portfolio/portfolio.controller';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { portfolioSchema } from 'src/portfolio/schema/portfolio.model';
import { portfolioHistorySchema } from 'src/portfolio/schema/portfolio-history.model';

import { SubscriptionModule } from 'src/subscription/subscription.module';
import { TargetAllocationModule } from 'src/portfolio/target-allocation/target-allocation.module';
import { PortfolioCompositionService } from 'src/portfolio/composition/portfolio-composition.service';
import { tradeSchema } from 'src/fiscal/schema/trade.model';
import { PortfolioReturnsService } from 'src/portfolio/returns/portfolio-returns.service';
import { SectorBackfillScheduler } from 'src/portfolio/sector/sector-backfill.scheduler';

@Module({
	imports: [
		MongooseModule.forFeature([
			{
				name: 'Portfolio',
				schema: portfolioSchema,
			},
			{
				name: 'PortfolioHistory',
				schema: portfolioHistorySchema,
			},
			// Negociações são lidas para derivar fluxo de caixa (TRA-146).
			// Registradas localmente em vez de importar o FiscalModule inteiro —
			// mesmo padrão já usado por privacy.module.ts (CLAUDE.md §11).
			{
				name: 'Trade',
				schema: tradeSchema,
			},
		]),
		HttpModule,
		forwardRef(() => AssetsModule),
		SubscriptionModule,
		// Exporta TargetAllocationService e não importa PortfolioModule de
		// volta, então a dependência é de mão única — sem ciclo.
		TargetAllocationModule,
		MarketDataModule,
	],
	providers: [
		// Adapters
		BrapiStockAdapter,
		FiisApiAdapter,
		CoinGeckoAdapter,
		TwelveDataEtfAdapter,

		// Factory
		AssetAdapterFactory,

		// Services
		PortfolioService,
		PortfolioEnrichService,
		PortfolioIntelligenceService,
		PortfolioReturnsService,
		PortfolioCompositionService,

		// Schedulers
		// Backfill diário do setor dos ativos existentes (TRA-144): o
		// enriquecimento só roda ao adicionar ativo, então não alcança a base.
		SectorBackfillScheduler,
	],
	controllers: [PortfolioController],
	exports: [
		PortfolioService,
		PortfolioIntelligenceService,
		PortfolioReturnsService,
		PortfolioCompositionService,
	],
})
export class PortfolioModule {}
