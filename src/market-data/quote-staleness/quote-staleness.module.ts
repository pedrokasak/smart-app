import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { assetSchema } from 'src/assets/schema/assets.model';
import { portfolioSchema } from 'src/portfolio/schema/portfolio.model';
import { EventsModule } from 'src/events/events.module';
import { MarketDataModule } from 'src/market-data/market-data.module';
import { ThresholdsModule } from 'src/thresholds/thresholds.module';
import { QUOTE_FRESHNESS_STORE } from './application/ports/quote-freshness.port';
import { QuoteFreshnessScheduler } from './application/quote-freshness.scheduler';
import { QuoteRefreshService } from './application/quote-refresh.service';
import { QuoteStaleProducer } from './application/quote-stale.producer';
import { MongoQuoteFreshnessRepository } from './infrastructure/mongo-quote-freshness.repository';
import { QuoteFreshnessModel } from './infrastructure/quote-freshness.model';

/**
 * Frescor de cotacao (TRA-136, fase 7).
 *
 * Modulo proprio, e nao uma pasta dentro de `MarketDataModule`, porque a
 * dependencia so anda num sentido: aqui se depende do provider de mercado,
 * do barramento e da politica de limiares. `MarketDataModule` e importado
 * por meia dezena de modulos e nao pode passar a arrastar EventsModule e
 * ThresholdsModule junto — mesma razao pela qual a avaliacao de carteira
 * ficou fora de `PortfolioModule`.
 *
 * Portfolio e Asset sao registrados localmente (mesmos schemas; o Mongoose
 * deduplica por nome, entao nao ha colecao paralela).
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'QuoteFreshness', schema: QuoteFreshnessModel.schema },
			{ name: 'Portfolio', schema: portfolioSchema },
			{ name: 'Asset', schema: assetSchema },
		]),
		MarketDataModule,
		EventsModule,
		ThresholdsModule,
	],
	providers: [
		MongoQuoteFreshnessRepository,
		{
			provide: QUOTE_FRESHNESS_STORE,
			useExisting: MongoQuoteFreshnessRepository,
		},
		QuoteRefreshService,
		QuoteStaleProducer,
		QuoteFreshnessScheduler,
	],
	exports: [QuoteRefreshService, QuoteStaleProducer],
})
export class QuoteStalenessModule {}
