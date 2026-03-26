export type AssetClass =
	| 'equities'
	| 'real_estate'
	| 'crypto'
	| 'etf'
	| 'fund'
	| 'other';

export interface PortfolioIntelligencePosition {
	symbol: string;
	assetType: 'stock' | 'fii' | 'crypto' | 'etf' | 'fund' | 'other';
	quantity: number;
	totalValue?: number;
	price?: number;
	currentPrice?: number;
	sector?: string | null;
	geography?: string | null;
	volatility?: number | null;
	beta?: number | null;
	dividendYield?: number | null;
	annualDividendPerUnit?: number | null;
	dividendHistory?: Array<{
		date: Date | string;
		value: number;
	}>;
}

export interface PortfolioFitCandidateInput extends PortfolioIntelligencePosition {}

export interface PortfolioFitAllocationImpactEntry {
	assetClass: AssetClass;
	beforePercentage: number;
	afterPercentage: number;
	deltaPercentage: number;
}

export interface PortfolioFitConcentrationImpact {
	sector: string;
	beforePercentage: number;
	afterPercentage: number;
	deltaPercentage: number;
}

export interface PortfolioFitDiversificationImpact {
	beforeScore: number;
	afterScore: number;
	deltaScore: number;
	beforeStatus: DiversificationScore['status'];
	afterStatus: DiversificationScore['status'];
}

export interface PortfolioFitAnalysisOutput {
	candidate: {
		symbol: string;
		assetClass: AssetClass;
		sector: string;
		candidateValue: number;
		alreadyInPortfolio: boolean;
		hasCompleteMetadata: boolean;
	};
	impact: {
		allocationByClass: PortfolioFitAllocationImpactEntry[];
		sectorConcentration: PortfolioFitConcentrationImpact;
		diversification: PortfolioFitDiversificationImpact;
	};
	classification: 'bom' | 'neutro' | 'ruim';
	confidence: 'high' | 'medium' | 'low';
	signals: string[];
}

export interface AllocationEntry {
	key: string;
	value: number;
	percentage: number;
}

export interface ConcentrationEntry extends AllocationEntry {
	severity: 'low' | 'medium' | 'high';
}

export interface DiversificationScore {
	score: number;
	maxScore: number;
	status: 'poor' | 'moderate' | 'good' | 'excellent';
	components: {
		assetSpread: number;
		classSpread: number;
		sectorSpread: number;
	};
}

export interface PortfolioRiskAnalysis {
	score: number;
	level: 'low' | 'medium' | 'high';
	flags: Array<{
		code: string;
		severity: 'low' | 'medium' | 'high';
		message: string;
	}>;
}

export interface DividendFlowProjection {
	modelVersion: 'deterministic_v1';
	projectedAnnualIncome: number;
	projectedMonthlyIncome: number;
	projectedYieldOnPortfolioPct: number;
	coverage: {
		positionsWithData: number;
		positionsWithoutData: number;
		dataCoveragePct: number;
	};
	byAssetClass: Array<{
		assetClass: AssetClass;
		annualIncome: number;
		monthlyIncome: number;
		sharePct: number;
	}>;
}

export interface RebalanceClassInput {
	assetClass: AssetClass;
	currentPercentage: number;
	targetPercentage: number | null;
	deltaPercentage: number | null;
	status: 'above_target' | 'below_target' | 'aligned' | 'no_target';
}

export interface RebalanceExposureImbalance {
	type: 'asset' | 'sector';
	key: string;
	status: 'above_limit' | 'below_limit';
	severity: 'low' | 'medium' | 'high';
	currentPercentage: number;
	minRecommendedPercentage: number | null;
	maxRecommendedPercentage: number | null;
}

export interface PortfolioIntelligenceRebalanceConfig {
	targetAllocationByClass?: Partial<Record<AssetClass, number>>;
	sectorLimitsByKey?: Record<
		string,
		{
			minPct?: number;
			maxPct?: number;
		}
	>;
	assetMaxConcentrationPct?: number;
	sectorMaxConcentrationPct?: number;
}

export interface RebalanceSuggestionInputs {
	modelVersion: 'rebalance_inputs_v1';
	hasTargetAllocation: boolean;
	classAllocationSignals: RebalanceClassInput[];
	assetConcentrationSignals: RebalanceExposureImbalance[];
	sectorLimitSignals: RebalanceExposureImbalance[];
	exposureImbalances: RebalanceExposureImbalance[];
	hasRelevantSignals: boolean;
}

export interface PortfolioIntelligenceThresholds {
	highAssetConcentrationPct: number;
	mediumAssetConcentrationPct: number;
	highClassConcentrationPct: number;
	mediumClassConcentrationPct: number;
	highSectorConcentrationPct: number;
	mediumSectorConcentrationPct: number;
}

export interface PortfolioIntelligenceOutput {
	facts: {
		totalValue: number;
		positionsCount: number;
		assetClassesCount: number;
		sectorsCount: number;
		geographiesCount: number;
		unknownSectorExposurePct: number;
		unknownGeographyExposurePct: number;
		allocationByClass: AllocationEntry[];
		allocationByAsset: AllocationEntry[];
		allocationByGeography: AllocationEntry[];
		concentrationByAsset: ConcentrationEntry[];
		concentrationBySector: ConcentrationEntry[];
	};
	rules: {
		thresholds: PortfolioIntelligenceThresholds;
	};
	estimates: {
		diversification: DiversificationScore;
		risk: PortfolioRiskAnalysis;
		dividendProjection: DividendFlowProjection;
		rebalanceSuggestionInputs: RebalanceSuggestionInputs;
		riskModelVersion: 'heuristic_v1';
	};
}
