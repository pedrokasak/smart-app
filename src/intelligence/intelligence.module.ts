import { Module } from '@nestjs/common';
import { ComparisonModule } from 'src/comparison/comparison.module';
import { TaxEngineModule } from 'src/fiscal/tax-engine/tax-engine.module';
import { FutureSimulatorService } from 'src/intelligence/application/future-simulator.service';
import { InvestmentCommitteeBriefingService } from 'src/intelligence/application/investment-committee-briefing.service';
import { InvestorProfileInsightsService } from 'src/intelligence/application/investor-profile-insights.service';
import { OpportunityRadarService } from 'src/intelligence/application/opportunity-radar.service';
import { PremiumInsightsService } from 'src/intelligence/application/premium-insights.service';
import { TrackerrScoreService } from 'src/intelligence/application/trackerr-score.service';
import { TradeDecisionService } from 'src/intelligence/application/trade-decision.service';
import { UnifiedIntelligenceFacade } from 'src/intelligence/application/unified-intelligence.facade';
import { MarketDataModule } from 'src/market-data/market-data.module';
import { PortfolioModule } from 'src/portfolio/portfolio.module';

@Module({
	imports: [
		PortfolioModule,
		TaxEngineModule,
		ComparisonModule,
		MarketDataModule,
	],
	providers: [
		UnifiedIntelligenceFacade,
		OpportunityRadarService,
		FutureSimulatorService,
		PremiumInsightsService,
		TradeDecisionService,
		TrackerrScoreService,
		InvestorProfileInsightsService,
		InvestmentCommitteeBriefingService,
	],
	exports: [
		UnifiedIntelligenceFacade,
		TradeDecisionService,
		TrackerrScoreService,
		InvestorProfileInsightsService,
		InvestmentCommitteeBriefingService,
	],
})
export class IntelligenceModule {}
