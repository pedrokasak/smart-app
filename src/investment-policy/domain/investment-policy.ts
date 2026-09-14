/**
 * Política de investimento do usuário (TRA-175): os limites e alvos que ele
 * mesmo define em Configurações. Percentuais em pontos de 0 a 100.
 */
export const INVESTMENT_BENCHMARKS = [
	'IBOV_CDI',
	'IBOV',
	'CDI',
	'IFIX',
	'SMLL',
	'IVVB11',
] as const;

export type InvestmentBenchmark = (typeof INVESTMENT_BENCHMARKS)[number];

export interface InvestmentPolicy {
	maxAssetWeightPct: number;
	maxSectorWeightPct: number;
	fixedIncomeTargetPct: number;
	brStocksTargetPct: number;
	maxCryptoPct: number;
	benchmark: InvestmentBenchmark;
}

/** Valores de partida do handoff para quem ainda não salvou nada. */
export const DEFAULT_INVESTMENT_POLICY: InvestmentPolicy = {
	maxAssetWeightPct: 8,
	maxSectorWeightPct: 25,
	fixedIncomeTargetPct: 25,
	brStocksTargetPct: 28,
	maxCryptoPct: 5,
	benchmark: 'IBOV_CDI',
};

/** Quantas versões anteriores ficam guardadas. */
export const INVESTMENT_POLICY_HISTORY_LIMIT = 20;

/**
 * Regras que atravessam campos (as de faixa ficam no DTO). Devolve a
 * mensagem do primeiro problema ou `null`.
 */
export function findPolicyInconsistency(
	policy: InvestmentPolicy
): string | null {
	if (policy.maxAssetWeightPct > policy.maxSectorWeightPct) {
		return 'O limite por ativo não pode ser maior que o limite por setor.';
	}
	if (policy.fixedIncomeTargetPct + policy.brStocksTargetPct > 100) {
		return 'Os alvos de renda fixa e ações BR somam mais de 100%.';
	}
	return null;
}
