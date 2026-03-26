import { Module } from '@nestjs/common';
import { ComparisonModule } from 'src/comparison/comparison.module';
import { TaxEngineModule } from 'src/fiscal/tax-engine/tax-engine.module';
import { FutureSimulatorService } from 'src/intelligence/application/future-simulator.service';
import { OpportunityRadarService } from 'src/intelligence/application/opportunity-radar.service';
import { PremiumInsightsService } from 'src/intelligence/application/premium-insights.service';
import { UnifiedIntelligenceFacade } from 'src/intelligence/application/unified-intelligence.facade';
import { MarketDataModule } from 'src/market-data/market-data.module';
import { PortfolioModule } from 'src/portfolio/portfolio.module';

@Module({
	imports: [PortfolioModule, TaxEngineModule, ComparisonModule, MarketDataModule],
	providers: [
		UnifiedIntelligenceFacade,
		OpportunityRadarService,
		FutureSimulatorService,
		PremiumInsightsService,
	],
	exports: [UnifiedIntelligenceFacade],
})
export class IntelligenceModule {}
