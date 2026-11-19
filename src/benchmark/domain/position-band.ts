import type { CohortStats } from 'src/benchmark/domain/cohort';

/**
 * Posição em faixas, nunca em ranking: "entre os 25% mais diversificados".
 * Quem está no começo da jornada vê uma faixa, não um número de posição.
 */
export type PositionBand =
	| 'top_quarter'
	| 'above_median'
	| 'below_median'
	| 'bottom_quarter';

export function positionIn(value: number, stats: CohortStats): PositionBand {
	if (value >= stats.p75) return 'top_quarter';
	if (value >= stats.p50) return 'above_median';
	if (value > stats.p25) return 'below_median';
	return 'bottom_quarter';
}
