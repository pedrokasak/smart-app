import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserModel } from 'src/users/schema/user.model';
import { ComparisonModule } from 'src/comparison/comparison.module';
import { TaxEngineModule } from 'src/fiscal/tax-engine/tax-engine.module';
import { FutureSimulatorService } from 'src/intelligence/application/future-simulator.service';
import { InvestmentCommitteeBriefingService } from 'src/intelligence/application/investment-committee-briefing.service';
import { InvestorProfileInsightsService } from 'src/intelligence/application/investor-profile-insights.service';
import { InvestorProfileService } from 'src/intelligence/application/investor-profile/investor-profile.service';
import { InvestorProfileScheduler } from 'src/intelligence/application/investor-profile/investor-profile.scheduler';
import { AssetOpinionService } from 'src/intelligence/application/asset-opinion.service';
import { OpportunityRadarService } from 'src/intelligence/application/opportunity-radar.service';
import { PortfolioErrorRadarService } from 'src/intelligence/application/portfolio-error-radar.service';
import { PortfolioScoreService } from 'src/intelligence/application/portfolio-score.service';
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
		MongooseModule.forFeature([{ name: 'User', schema: UserModel.schema }]),
	],
	providers: [
		UnifiedIntelligenceFacade,
		OpportunityRadarService,
		PortfolioScoreService,
		PortfolioErrorRadarService,
		AssetOpinionService,
		FutureSimulatorService,
		PremiumInsightsService,
		TradeDecisionService,
		TrackerrScoreService,
		InvestorProfileInsightsService,
		InvestmentCommitteeBriefingService,
		InvestorProfileService,
		InvestorProfileScheduler,
	],
	exports: [
		UnifiedIntelligenceFacade,
		PortfolioScoreService,
		PortfolioErrorRadarService,
		AssetOpinionService,
		TradeDecisionService,
		TrackerrScoreService,
		InvestorProfileInsightsService,
		InvestmentCommitteeBriefingService,
		InvestorProfileService,
	],
})
export class IntelligenceModule {}
