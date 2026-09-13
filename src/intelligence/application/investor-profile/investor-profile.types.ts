export type SophisticationLevel = 'beginner' | 'intermediate' | 'experienced';
export type RiskToleranceLevel = 'conservative' | 'moderate' | 'aggressive';
export type InvestorProfileSource = 'inferred' | 'user_override';

export interface InvestorProfileSignalsInput {
	distinctAssetCount: number;
	distinctSectorCount: number;
	tradesLast12Months: number;
	accountAgeDays: number;
	variableIncomeAllocationPct: number;
	hasAdvancedInstrument: boolean;
}

export interface InvestorSophisticationProfile {
	sophistication: SophisticationLevel;
	riskTolerance: RiskToleranceLevel;
	confidence: number;
	signals: InvestorProfileSignalsInput;
	source: InvestorProfileSource;
}
