/**
 * Percentil por posto mais próximo (nearest rank) sobre valores já ordenados.
 * Sem interpolação: o resultado é sempre um valor que existe na amostra,
 * antes do arredondamento que o torna não rastreável.
 */
export function percentile(sorted: readonly number[], p: number): number {
	if (!sorted.length) return Number.NaN;
	const rank = Math.ceil(p * sorted.length);
	const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
	return sorted[index];
}

/** Score vira inteiro. */
export const roundScore = (value: number): number => Math.round(value);

/** Fração vira pontos percentuais, em passos de 0,5 (0.1234 -> 12.5). */
export const roundReturnPp = (fraction: number): number =>
	Math.round(fraction * 100 * 2) / 2;
