import { Injectable } from '@nestjs/common';
import { ComparisonEngineService } from 'src/comparison/application/comparison-engine.service';
import { TaxEngineService } from 'src/fiscal/tax-engine/application/tax-engine.service';
import { FutureSimulatorService } from 'src/intelligence/application/future-simulator.service';
import { OpportunityRadarService } from 'src/intelligence/application/opportunity-radar.service';
import { PremiumInsightsService } from 'src/intelligence/application/premium-insights.service';
import { TrackerrScoreService } from 'src/intelligence/application/trackerr-score.service';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';
import {
	FutureSimulatorInput,
	FutureSimulatorOutput,
	OpportunityRadarInput,
	OpportunityRadarOutput,
	PremiumInsightsInput,
	PremiumInsightsOutput,
	UnifiedAssetFitInput,
	UnifiedAssetFitOutput,
	UnifiedCompareAssetsInput,
	UnifiedCompareAssetsOutput,
	UnifiedPortfolioContextInput,
	UnifiedPortfolioRiskOutput,
	UnifiedPortfolioSummaryOutput,
	UnifiedSellSimulationInput,
	UnifiedSellSimulationOutput,
	UnifiedTrackerrScoreInput,
	UnifiedTrackerrScoreOutput,
} from 'src/intelligence/application/unified-intelligence.types';

@Injectable()
export class UnifiedIntelligenceFacade {
	constructor(
		private readonly portfolioIntelligenceService: PortfolioIntelligenceService,
		private readonly comparisonEngineService: ComparisonEngineService,
		private readonly taxEngineService: TaxEngineService,
		private readonly opportunityRadarService: OpportunityRadarService,
		private readonly futureSimulatorService: FutureSimulatorService,
		private readonly premiumInsightsService: PremiumInsightsService,
		private readonly trackerrScoreService: TrackerrScoreService
	) {}

	getPortfolioSummary(
		input: UnifiedPortfolioContextInput
	): UnifiedPortfolioSummaryOutput {
		const analysis = this.portfolioIntelligenceService.analyzePositions(
			input.positions,
			input.thresholds,
			input.rebalanceConfig
		);

		return {
			totalValue: analysis.facts.totalValue,
			positionsCount: analysis.facts.positionsCount,
			allocationByClass: analysis.facts.allocationByClass,
			allocationByAsset: analysis.facts.allocationByAsset,
			allocationByGeography: analysis.facts.allocationByGeography,
			diversification: analysis.estimates.diversification,
			dividendProjection: analysis.estimates.dividendProjection,
		};
	}

	getPortfolioRiskAnalysis(
		input: UnifiedPortfolioContextInput
	): UnifiedPortfolioRiskOutput {
		const analysis = this.portfolioIntelligenceService.analyzePositions(
			input.positions,
			input.thresholds,
			input.rebalanceConfig
		);

		return {
			risk: analysis.estimates.risk,
			concentrationByAsset: analysis.facts.concentrationByAsset,
			concentrationBySector: analysis.facts.concentrationBySector,
			rebalanceSuggestionInputs: analysis.estimates.rebalanceSuggestionInputs,
		};
	}

	analyzeAssetFit(input: UnifiedAssetFitInput): UnifiedAssetFitOutput {
		return this.portfolioIntelligenceService.analyzePortfolioFit(
			input.positions,
			input.candidate,
			input.thresholds
		);
	}

	compareAssets(
		input: UnifiedCompareAssetsInput
	): Promise<UnifiedCompareAssetsOutput> {
		return this.comparisonEngineService.compareAssets({
			symbols: input.symbols,
			portfolioPositions: input.portfolioPositions,
			thresholds: input.thresholds,
		});
	}

	simulateSell(input: UnifiedSellSimulationInput): UnifiedSellSimulationOutput {
		return this.taxEngineService.simulateSaleImpact(input);
	}

	detectOpportunities(
		input: OpportunityRadarInput
	): Promise<OpportunityRadarOutput> {
		return this.opportunityRadarService.detect(input);
	}

	simulateFuture(input: FutureSimulatorInput): FutureSimulatorOutput {
		return this.futureSimulatorService.simulate(input);
	}

	getPremiumInsights(
		input: PremiumInsightsInput
	): Promise<PremiumInsightsOutput> {
		return this.premiumInsightsService.generate(input);
	}

	getTrackerrScore(
		input: UnifiedTrackerrScoreInput
	): UnifiedTrackerrScoreOutput {
		return this.trackerrScoreService.build(input);
	}
}
