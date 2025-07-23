import { Module } from '@nestjs/common';
import { StockService } from './stocks.service';
import { BrapiAdapter } from './adapter/brapiDataApi';
import { TwelveDataAdapter } from './adapter/twelveDataApi';
import { HttpModule } from '@nestjs/axios';
import { StocksController } from './stocks.controller';

@Module({
	imports: [HttpModule],
	controllers: [StocksController],
	providers: [StockService, BrapiAdapter, TwelveDataAdapter],
	exports: [StockService],
})
export class StockModule {}
