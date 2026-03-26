import { ComparisonEngineOutput } from 'src/comparison/application/comparison-engine.service';
import {
	SellSimulationInput,
	SellSimulationOutput,
} from 'src/fiscal/tax-engine/domain/tax-engine.types';
import {
	PortfolioFitAnalysisOutput,
	PortfolioFitCandidateInput,
	PortfolioIntelligenceOutput,
	PortfolioIntelligencePosition,
	PortfolioIntelligenceRebalanceConfig,
	PortfolioIntelligenceThresholds,
} from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';

export interface UnifiedPortfolioContextInput {
	positions: PortfolioIntelligencePosition[];
	thresholds?: Partial<PortfolioIntelligenceThresholds>;
	rebalanceConfig?: PortfolioIntelligenceRebalanceConfig;
}

export interface UnifiedPortfolioSummaryOutput {
	totalValue: number;
	positionsCount: number;
	allocationByClass: PortfolioIntelligenceOutput['facts']['allocationByClass'];
	allocationByAsset: PortfolioIntelligenceOutput['facts']['allocationByAsset'];
	allocationByGeography: PortfolioIntelligenceOutput['facts']['allocationByGeography'];
	diversification: PortfolioIntelligenceOutput['estimates']['diversification'];
	dividendProjection: PortfolioIntelligenceOutput['estimates']['dividendProjection'];
}

export interface UnifiedPortfolioRiskOutput {
	risk: PortfolioIntelligenceOutput['estimates']['risk'];
	concentrationByAsset: PortfolioIntelligenceOutput['facts']['concentrationByAsset'];
	concentrationBySector: PortfolioIntelligenceOutput['facts']['concentrationBySector'];
	rebalanceSuggestionInputs: PortfolioIntelligenceOutput['estimates']['rebalanceSuggestionInputs'];
}

export interface UnifiedAssetFitInput {
	positions: PortfolioIntelligencePosition[];
	candidate: PortfolioFitCandidateInput;
	thresholds?: Partial<PortfolioIntelligenceThresholds>;
}

export type UnifiedAssetFitOutput = PortfolioFitAnalysisOutput;

export interface UnifiedCompareAssetsInput {
	symbols: string[];
	portfolioPositions?: PortfolioIntelligencePosition[];
	thresholds?: Partial<PortfolioIntelligenceThresholds>;
}

export type UnifiedCompareAssetsOutput = ComparisonEngineOutput;

export type UnifiedSellSimulationInput = SellSimulationInput;
export type UnifiedSellSimulationOutput = SellSimulationOutput;

export type OpportunityRadarKind = 'risk' | 'opportunity' | 'fiscal' | 'rebalance';
export type OpportunityRadarPriority = 'critical' | 'high' | 'medium' | 'low';

export interface OpportunityRadarRuleConfig {
	maxPriceToEarnings: number;
	minDividendYield: number;
	maxDipChangePercent: number;
	underallocationTolerancePct: number;
	maxSignalsTotal?: number;
	maxSignalsPerKind?: Partial<Record<OpportunityRadarKind, number>>;
}

export interface OpportunityRadarSignal {
	id: string;
	symbol: string | null;
	kind: OpportunityRadarKind;
	priority: OpportunityRadarPriority;
	score: number;
	title: string;
	details: string[];
}

export interface OpportunityRadarOpportunity {
	symbol: string;
	type:
		| 'attractive_range'
		| 'portfolio_fit'
		| 'sector_underallocated'
		| 'watchlist_trigger';
	rationale: {
		signals: string[];
		metrics: {
			price: number | null;
			priceToEarnings: number | null;
			dividendYield: number | null;
			changePercent: number | null;
			sector: string;
		};
	};
	expectedPortfolioImpact: {
		fitClassification: 'bom' | 'neutro' | 'ruim';
		diversificationDeltaScore: number;
		sectorDeltaPercentage: number;
		underallocatedSectorGap: number | null;
	};
	dataQuality: {
		partial: boolean;
		fallbackUsed: boolean;
		fallbackSources: string[];
	};
}

export interface OpportunityRadarInput {
	portfolioPositions: PortfolioIntelligencePosition[];
	candidateSymbols?: string[];
	watchlistSymbols?: string[];
	sectorTargetAllocation?: Record<string, number>;
	rules?: Partial<OpportunityRadarRuleConfig>;
	fiscalContext?: {
		hasCompensableLoss?: boolean;
		estimatedTaxOnNextSell?: number | null;
	};
}

export interface OpportunityRadarOutput {
	modelVersion: 'opportunity_radar_v1';
	opportunities: OpportunityRadarOpportunity[];
	underallocatedSectors: Array<{
		sector: string;
		currentPercentage: number;
		targetPercentage: number;
		deltaPercentage: number;
	}>;
	signals: OpportunityRadarSignal[];
	unavailableSymbols: string[];
	warnings: string[];
}

export type FutureSimulatorHorizon = '6m' | '1y' | '5y' | '10y';

export interface FutureSimulatorInput {
	positions: PortfolioIntelligencePosition[];
	horizon: FutureSimulatorHorizon;
	monthlyContribution?: number;
}

export interface FutureSimulatorScenarioOutput {
	label: 'pessimistic' | 'base' | 'optimistic';
	annualReturnPct: number;
	projectedValue: number;
	range: {
		lower: number;
		upper: number;
	};
	projectedDividendFlow: {
		monthly: number;
		annual: number;
	};
}

export interface FutureSimulatorDividendProjectionOutput {
	modelVersion: 'deterministic_dividend_projection_v1';
	current: {
		monthly: number;
		annual: number;
	};
	scenarios: {
		pessimistic: {
			monthly: number;
			annual: number;
		};
		base: {
			monthly: number;
			annual: number;
		};
		optimistic: {
			monthly: number;
			annual: number;
		};
	};
	coverage: {
		positionsWithData: number;
		positionsWithoutData: number;
		dataCoveragePct: number;
	};
	confidence: 'high' | 'medium' | 'low';
}

export interface FutureSimulatorOutput {
	modelVersion: 'future_simulator_v1';
	horizon: FutureSimulatorHorizon;
	months: number;
	currentPortfolioValue: number;
	monthlyContribution: number;
	scenarios: {
		pessimistic: FutureSimulatorScenarioOutput;
		base: FutureSimulatorScenarioOutput;
		optimistic: FutureSimulatorScenarioOutput;
	};
	assumptions: {
		contributionFrequency: 'monthly';
		scenarioReturnsAnnualPct: {
			pessimistic: number;
			base: number;
			optimistic: number;
		};
	};
	dividendProjection: FutureSimulatorDividendProjectionOutput;
	limitations: string[];
	confidence: 'high' | 'medium' | 'low';
}

export type PremiumInsightCategory =
	| 'risk'
	| 'opportunity'
	| 'fiscal'
	| 'future'
	| 'rebalance';
export type PremiumInsightPriority = 'critical' | 'high' | 'medium' | 'low';
export type PremiumInsightPlan = 'premium' | 'global_investor';

export interface PremiumInsightItem {
	id: string;
	priority: PremiumInsightPriority;
	category: PremiumInsightCategory;
	title: string;
	justification: string[];
	suggestedAction: string;
	relatedSymbols: string[];
	origin: 'portfolio' | 'opportunity_radar' | 'tax_engine' | 'future_simulator';
	score: number;
}

export interface PremiumInsightsInput {
	plan: PremiumInsightPlan;
	positions: PortfolioIntelligencePosition[];
	opportunityInput?: {
		candidateSymbols?: string[];
		watchlistSymbols?: string[];
		sectorTargetAllocation?: Record<string, number>;
		rules?: Partial<OpportunityRadarRuleConfig>;
	};
	futureInput?: {
		horizon: FutureSimulatorHorizon;
		monthlyContribution?: number;
	};
	fiscalInput?: {
		sellSimulation?: UnifiedSellSimulationInput;
		hasCompensableLoss?: boolean;
	};
}

export interface PremiumInsightsOutput {
	modelVersion: 'premium_insights_v1';
	plan: PremiumInsightPlan;
	insights: PremiumInsightItem[];
	signals: {
		risk: number;
		opportunity: number;
		fiscal: number;
		future: number;
		rebalance: number;
	};
	warnings: string[];
}
