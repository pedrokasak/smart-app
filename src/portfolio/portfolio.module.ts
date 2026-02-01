import { HttpModule } from '@nestjs/axios';
import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssetsModule } from 'src/assets/assets.module';
import { AssetAdapterFactory } from 'src/portfolio/adapter/asset-adapter.factory';
import { BrapiStockAdapter } from 'src/portfolio/adapter/brapi.adapter';
import { CoinGeckoAdapter } from 'src/portfolio/adapter/coingecko.adapter';
import { FiisApiAdapter } from 'src/portfolio/adapter/fiis-adapter';
import { TwelveDataEtfAdapter } from 'src/portfolio/adapter/twelvedata.adapter';
import { PortfolioEnrichService } from 'src/portfolio/portfolio-enrich.service';
import { PortfolioController } from 'src/portfolio/portfolio.controller';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { portfolioSchema } from 'src/portfolio/schema/portfolio.model';

@Module({
	imports: [
		MongooseModule.forFeature([
			{
				name: 'Portfolio',
				schema: portfolioSchema,
			},
		]),
		HttpModule,
		forwardRef(() => AssetsModule),
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
		PortfolioService,
	],
	controllers: [PortfolioController],
	exports: [PortfolioService],
})
export class PortfolioModule {}
