import { TaxAssetType } from 'src/fiscal/tax-engine/domain/tax-engine.types';

export type TrackerrScorePillar =
	| 'qualidade'
	| 'risco'
	| 'valuation'
	| 'fiscal'
	| 'portfolio_fit';

export interface TrackerrScoreReasonCode {
	code: string;
	pillar: TrackerrScorePillar;
	direction: 'up' | 'down' | 'neutral';
	description: string;
	weightImpact: number;
}

export interface TrackerrScorePillarBreakdown {
	pillar: TrackerrScorePillar;
	weight: number;
	score: number;
	weightedScore: number;
	reasonCodes: TrackerrScoreReasonCode[];
}

export interface TrackerrScoreOutput {
	symbol: string;
	assetType: TaxAssetType | 'other';
	status: 'ok' | 'degraded';
	overall: number;
	overallScore: number;
	weights: Record<TrackerrScorePillar, number>;
	pillars: TrackerrScorePillarBreakdown[];
	reasonCodes: {
		upward: string[];
		downward: string[];
	};
	warnings: string[];
	explanation: {
		summary: string;
		topPositiveDrivers: string[];
		topNegativeDrivers: string[];
	};
}

export interface TrackerrScoreInput {
	symbol: string;
	assetType: TaxAssetType | 'other';
	qualityMetrics: {
		roe: number | null;
		netMargin: number | null;
		dividendYield: number | null;
	};
	riskMetrics: {
		changePercent24h: number | null;
		concentrationPct: number | null;
	};
	valuationMetrics: {
		priceToEarnings: number | null;
		priceToBook: number | null;
	};
	fiscalMetrics: {
		estimatedTaxRateOnPnl: number | null;
		estimatedTaxAbsolute: number | null;
		monthlyExemptionApplied: boolean;
		hasOwnedPosition: boolean;
	};
	portfolioFitMetrics: {
		fitClassification: 'bom' | 'neutro' | 'ruim' | 'unknown';
		diversificationDeltaScore: number | null;
	};
	previousPillarScores?: Partial<Record<TrackerrScorePillar, number>>;
}
