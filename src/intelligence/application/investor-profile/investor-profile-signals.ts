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
	// distinctSectorCount nao gate mais 'experienced': Asset nao tem campo
	// `sector` persistido hoje (ver PortfolioService.getUserPortfolios), entao
	// esse sinal fica sempre em 0 em producao. distinctSectorCount continua
	// calculado e armazenado em signals para fins informativos/auditoria.
	const isExperienced =
		turnover >= HIGH_TURNOVER_THRESHOLD || input.hasAdvancedInstrument;
	if (isExperienced) return 'experienced';

	return 'intermediate';
}

export function computeRiskTolerance(
	variableIncomeAllocationPct: number
): RiskToleranceLevel {
	// Nunca retorna 'aggressive': o schema de Asset ainda nao tem um tipo de
	// renda fixa distinto (tudo que nao e 'fund' e tratado como renda
	// variavel), entao quase toda carteira real bateria 100% de alocacao
	// variavel. Ate existir um sinal real de renda fixa, o teto e 'moderate'
	// para evitar um rotulo de confianca falsa.
	if (variableIncomeAllocationPct < 40) return 'conservative';
	return 'moderate';
}

export function computeConfidence(
	input: InvestorProfileSignalsInput
): number {
	let confidence = 1.0;
	if (input.tradesLast12Months < 5) confidence -= 0.3;
	if (input.accountAgeDays < 30) confidence -= 0.3;
	if (input.distinctAssetCount < 3) confidence -= 0.2;
	if (input.accountAgeDays < 30) confidence = Math.min(confidence, 0.4);
	return Math.max(CONFIDENCE_FLOOR, confidence);
}

export { InvestorProfileSignalsInput };
