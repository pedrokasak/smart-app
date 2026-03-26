import { Module } from '@nestjs/common';
import { MARKET_DATA_PROVIDER } from 'src/market-data/application/market-data-provider.port';
import { TrackerrMarketDataFacade } from 'src/market-data/infrastructure/trackerr-market-data.facade';
import { FundamentusFallbackAdapter } from 'src/stocks/adapter/fundamentus-fallback.adapter';
import { StockModule } from 'src/stocks/stocks.module';

@Module({
	imports: [StockModule],
	providers: [
		TrackerrMarketDataFacade,
		FundamentusFallbackAdapter,
		{
			provide: MARKET_DATA_PROVIDER,
			useExisting: TrackerrMarketDataFacade,
		},
	],
	exports: [TrackerrMarketDataFacade, MARKET_DATA_PROVIDER],
})
export class MarketDataModule {}
