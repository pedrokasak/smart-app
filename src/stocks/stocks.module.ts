import { Module } from '@nestjs/common';
import { StockService } from './stocks.service';
import { BrapiAdapter } from './adapter/brapiDataApi';
import { TwelveDataAdapter } from './adapter/twelveDataApi';
import { HttpModule } from '@nestjs/axios';
import { StocksController } from './stocks.controller';
import { FundamentusFallbackAdapter } from './adapter/fundamentus-fallback.adapter';
import { CvmOpenDataAdapter } from './adapter/cvm-open-data.adapter';

@Module({
	imports: [HttpModule],
	controllers: [StocksController],
	providers: [
		StockService,
		BrapiAdapter,
		TwelveDataAdapter,
		FundamentusFallbackAdapter,
		CvmOpenDataAdapter,
	],
	exports: [StockService],
})
export class StockModule {}
