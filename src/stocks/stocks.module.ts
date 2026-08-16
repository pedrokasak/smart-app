import { Module } from '@nestjs/common';
import { StockService } from './stocks.service';
import { BrapiAdapter } from './adapter/brapiDataApi';
import { TwelveDataAdapter } from './adapter/twelveDataApi';
import { HttpModule } from '@nestjs/axios';
import { StocksController } from './stocks.controller';
import { FundamentusFallbackAdapter } from './adapter/fundamentus-fallback.adapter';
import { CvmOpenDataAdapter } from './adapter/cvm-open-data.adapter';
import { YahooFinanceAdapter } from 'src/market-data/infrastructure/yahoo-finance.adapter';
import { FundamentalsService } from './fundamentals/fundamentals.service';

@Module({
	imports: [HttpModule],
	controllers: [StocksController],
	providers: [
		StockService,
		BrapiAdapter,
		TwelveDataAdapter,
		FundamentusFallbackAdapter,
		CvmOpenDataAdapter,
		YahooFinanceAdapter,
		FundamentalsService,
	],
	exports: [StockService, FundamentalsService],
})
export class StockModule {}
