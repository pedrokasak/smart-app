/**
 * Limites de entrada do comparador (TRA-269). Moram num lugar só: o DTO os
 * aplica e `GET /fixed-income/rates` os entrega à tela, que valida antes de
 * enviar sem repetir número nenhum.
 */
export const COMPARISON_LIMITS = {
	principal: { min: 100, max: 1_000_000_000 },
	/** Mínimo de ~37 dias: abaixo de 30 dias incidiria IOF, que não é modelado. */
	years: { min: 0.1, max: 30 },
	cdiPct: { min: 0.1, max: 100 },
	ipcaPct: { min: -5, max: 100 },
	maxOffers: 6,
	maxTesouroIds: 10,
	labelMaxLength: 40,
} as const;
