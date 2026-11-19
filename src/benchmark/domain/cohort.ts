/**
 * Coortes do benchmark comparativo do Score (ADR-003, TRA-60).
 *
 * A comparação é sempre com um AGREGADO. Nada neste domínio recebe ou devolve
 * `userId`: o membro de uma coorte é só um conjunto de números anônimos.
 */

/** k-anonimato: uma coorte só é publicada com pelo menos este número de carteiras. */
export const COHORT_MIN_MEMBERS = 50;

/** Carteiras com menos histórico que isto não entram (viés de sobrevivência). */
export const MIN_HISTORY_MONTHS = 6;

/** Mesmos três níveis do investidor (iniciante, intermediário, avançado). */
export const COHORT_LEVELS = [
	'beginner',
	'intermediate',
	'experienced',
] as const;
export type CohortLevel = (typeof COHORT_LEVELS)[number];

/** Faixas de patrimônio, da menor para a maior. A ordem importa na fusão. */
export const WEALTH_BANDS = ['upto_50k', '50k_250k', 'above_250k'] as const;
export type WealthBand = (typeof WEALTH_BANDS)[number];

export const WEALTH_BAND_LIMITS = {
	upto50k: 50_000,
	upto250k: 250_000,
} as const;

export function wealthBandOf(netWorth: number): WealthBand {
	if (netWorth <= WEALTH_BAND_LIMITS.upto50k) return 'upto_50k';
	if (netWorth <= WEALTH_BAND_LIMITS.upto250k) return '50k_250k';
	return 'above_250k';
}

/** Uma carteira, sem identificação nenhuma. */
export interface CohortMember {
	level: CohortLevel;
	wealthBand: WealthBand;
	/** Score de diversificação, 0 a 100. */
	diversificationScore: number;
	/** Retorno de 12 meses (TWR), em fração: 0.12 = 12%. */
	return12m: number;
}

export interface CohortStats {
	p25: number;
	p50: number;
	p75: number;
}

/** O que é publicado de uma coorte. Não existe campo que aponte para uma pessoa. */
export interface CohortBenchmark {
	level: CohortLevel;
	/** Faixas que a coorte cobre; mais de uma quando coortes finas foram fundidas. */
	wealthBands: WealthBand[];
	/** Tamanho aproximado: arredondado para baixo, de 10 em 10. */
	sampleSizeBucket: number;
	/** Percentis do score, em inteiros. */
	score: CohortStats;
	/** Percentis do retorno, em pontos percentuais, em passos de 0,5. */
	return12mPp: CohortStats;
}

export const cohortKey = (level: CohortLevel, bands: readonly WealthBand[]) =>
	`${level}:${bands.join('+')}`;
