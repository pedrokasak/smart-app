import { Module } from '@nestjs/common';
import { ComparisonEngineService } from 'src/comparison/application/comparison-engine.service';
import { MarketDataModule } from 'src/market-data/market-data.module';
import { PortfolioModule } from 'src/portfolio/portfolio.module';

@Module({
	imports: [PortfolioModule, MarketDataModule],
	providers: [ComparisonEngineService],
	exports: [ComparisonEngineService],
})
export class ComparisonModule {}

