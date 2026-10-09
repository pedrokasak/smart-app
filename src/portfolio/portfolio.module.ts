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
import { QuoteFreshnessModel } from 'src/market-data/quote-staleness/infrastructure/quote-freshness.model';
import { MongoQuoteFreshnessRepository } from 'src/market-data/quote-staleness/infrastructure/mongo-quote-freshness.repository';
import { QUOTE_FRESHNESS_STORE } from 'src/market-data/quote-staleness/application/ports/quote-freshness.port';
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
import { RISK_FREE_RATE_PROVIDER } from 'src/portfolio/returns/risk-free-rate.port';
import { MacroIndicatorsModule } from 'src/macro-indicators/macro-indicators.module';
import { InvestmentFundsModule } from 'src/investment-funds/investment-funds.module';
import { INFLATION_PROVIDER } from 'src/portfolio/returns/inflation.port';
import {
	MacroInflationAdapter,
	MacroRiskFreeRateAdapter,
} from 'src/portfolio/returns/macro-series.adapters';
import { PortfolioRiskContributionService } from 'src/portfolio/risk/portfolio-risk-contribution.service';
import { PortfolioHistoryBackfillService } from 'src/portfolio/history/portfolio-history-backfill.service';
import { PortfolioHistoryRepairScheduler } from 'src/portfolio/history/portfolio-history-repair.scheduler';
import { upcomingDividendSchema } from 'src/portfolio/upcoming-dividends/upcoming-dividend.model';
import { UpcomingDividendsService } from 'src/portfolio/upcoming-dividends/upcoming-dividends.service';

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
			// Última cotação por símbolo, para marcar a carteira a mercado na
			// leitura (TRA-247). Mesmo schema do QuoteStalenessModule.
			{ name: 'QuoteFreshness', schema: QuoteFreshnessModel.schema },
			// Negociações são lidas para derivar fluxo de caixa (TRA-146).
			// Registradas localmente em vez de importar o FiscalModule inteiro —
			// mesmo padrão já usado por privacy.module.ts (CLAUDE.md §11).
			{
				name: 'Trade',
				schema: tradeSchema,
			},
			{
				name: 'UpcomingDividend',
				schema: upcomingDividendSchema,
			},
		]),
		HttpModule,
		forwardRef(() => AssetsModule),
		SubscriptionModule,
		// Exporta TargetAllocationService e não importa PortfolioModule de
		// volta, então a dependência é de mão única — sem ciclo.
		TargetAllocationModule,
		// Cota diária de fundo (TRA-276); o módulo de fundos não importa a carteira.
		InvestmentFundsModule,
		MarketDataModule,
		// Séries macro do BACEN (TRA-227): CDI do Sharpe e IPCA do retorno real.
		MacroIndicatorsModule,
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
		// CDI do Sharpe e IPCA do retorno real vêm do espelho local das séries
		// do BACEN (TRA-227), não de uma ida ao BACEN por cálculo.
		MacroRiskFreeRateAdapter,
		{ provide: RISK_FREE_RATE_PROVIDER, useExisting: MacroRiskFreeRateAdapter },
		MacroInflationAdapter,
		{ provide: INFLATION_PROVIDER, useExisting: MacroInflationAdapter },
		PortfolioRiskContributionService,
		PortfolioHistoryBackfillService,
		UpcomingDividendsService,
		MongoQuoteFreshnessRepository,
		{
			provide: QUOTE_FRESHNESS_STORE,
			useExisting: MongoQuoteFreshnessRepository,
		},

		// Schedulers
		// Backfill diário do setor dos ativos existentes (TRA-144): o
		// enriquecimento só roda ao adicionar ativo, então não alcança a base.
		SectorBackfillScheduler,
		// Corrige o histórico reconstruído a custo quando os fechamentos
		// passam a existir (TRA-279).
		PortfolioHistoryRepairScheduler,
	],
	controllers: [PortfolioController],
	exports: [
		PortfolioService,
		PortfolioIntelligenceService,
		PortfolioReturnsService,
		PortfolioCompositionService,
		PortfolioHistoryBackfillService,
		PortfolioRiskContributionService,
	],
})
export class PortfolioModule {}
