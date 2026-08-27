import {
	InvestorProfileSignalsInput,
	RiskToleranceLevel,
	SophisticationLevel,
} from './investor-profile.types';

const BDR_SUFFIX_PATTERN = /^[A-Z]{4,5}3[2-9]$/;
const HIGH_TURNOVER_THRESHOLD = 4;
const CONFIDENCE_FLOOR = 0.1;

export function resolveTurnover(
	distinctAssetCount: number,
	tradesLast12Months: number
): number {
	if (distinctAssetCount <= 0) return 0;
	return tradesLast12Months / distinctAssetCount;
}

export function isAdvancedInstrumentSymbol(
	symbol: string,
	assetType: string
): boolean {
	if (assetType === 'etf') return true;
	return BDR_SUFFIX_PATTERN.test(String(symbol || '').toUpperCase());
}

export function computeSophistication(
	input: InvestorProfileSignalsInput
): SophisticationLevel {
	const isBeginner =
		input.distinctAssetCount <= 2 || input.accountAgeDays < 30;
	if (isBeginner) return 'beginner';

	const turnover = resolveTurnover(
		input.distinctAssetCount,
		input.tradesLast12Months
	);
	const isExperienced =
		input.distinctSectorCount >= 3 &&
		(turnover >= HIGH_TURNOVER_THRESHOLD || input.hasAdvancedInstrument);
	if (isExperienced) return 'experienced';

	return 'intermediate';
}

export function computeRiskTolerance(
	variableIncomeAllocationPct: number
): RiskToleranceLevel {
	if (variableIncomeAllocationPct > 80) return 'aggressive';
	if (variableIncomeAllocationPct >= 40) return 'moderate';
	return 'conservative';
}

export function computeConfidence(
	input: InvestorProfileSignalsInput
): number {
	let confidence = 1.0;
	if (input.tradesLast12Months < 5) confidence -= 0.3;
	if (input.accountAgeDays < 30) confidence -= 0.3;
	if (input.distinctAssetCount < 3) confidence -= 0.2;
	// Quantize to 1 decimal place to handle floating-point precision and apply floor
	confidence = Math.floor(confidence * 10) / 10;
	return Math.max(CONFIDENCE_FLOOR, confidence);
}

export { InvestorProfileSignalsInput };
