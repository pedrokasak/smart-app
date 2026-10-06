/**
 * Aritmética de taxas de renda fixa (TRA-269). Funções puras; toda taxa entra e
 * sai em PERCENTUAL (13,65 = 13,65% a.a.), efetiva e na base de 252 dias úteis.
 *
 * Por que não somar nem multiplicar taxas anuais direto: "110% do CDI" aplica
 * 110% à taxa DIÁRIA do CDI e capitaliza; "IPCA + 7%" é o produto dos dois
 * fatores, não a soma. As aproximações lineares erram o ponto de empate entre
 * papéis justamente quando a diferença entre eles é pequena.
 */

export const BUSINESS_DAYS_PER_YEAR = 252;
export const CALENDAR_DAYS_PER_YEAR = 365;

/** Taxa anual efetiva (base 252) equivalente a uma taxa diária em %. */
export function annualFromDailyPct(dailyPct: number): number {
	return ((1 + dailyPct / 100) ** BUSINESS_DAYS_PER_YEAR - 1) * 100;
}

function dailyFactorFromAnnualPct(annualPct: number): number {
	return (1 + annualPct / 100) ** (1 / BUSINESS_DAYS_PER_YEAR) - 1;
}

/** "`percentOfCdi`% do CDI" como taxa anual efetiva. */
export function percentOfCdiToAnnualPct(
	cdiAnnualPct: number,
	percentOfCdi: number
): number {
	const daily = dailyFactorFromAnnualPct(cdiAnnualPct);
	return (
		((1 + daily * (percentOfCdi / 100)) ** BUSINESS_DAYS_PER_YEAR - 1) * 100
	);
}

/** Inverso de `percentOfCdiToAnnualPct`: quantos % do CDI rendem `annualPct`. */
export function annualPctToPercentOfCdi(
	cdiAnnualPct: number,
	annualPct: number
): number {
	return (
		(dailyFactorFromAnnualPct(annualPct) /
			dailyFactorFromAnnualPct(cdiAnnualPct)) *
		100
	);
}

/** CDI + spread (Tesouro Selic): fatores se multiplicam. */
export function cdiPlusSpreadToAnnualPct(
	cdiAnnualPct: number,
	spreadPct: number
): number {
	return ((1 + cdiAnnualPct / 100) * (1 + spreadPct / 100) - 1) * 100;
}

/** Inflação + juro real (Tesouro IPCA+, NTN-B): fatores se multiplicam. */
export function ipcaPlusToAnnualPct(
	ipcaAnnualPct: number,
	realPct: number
): number {
	return ((1 + ipcaAnnualPct / 100) * (1 + realPct / 100) - 1) * 100;
}

/** Retorno real a partir de nominal e inflação anuais, em %. */
export function realReturnPct(
	nominalPct: number,
	inflationPct: number
): number {
	return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}

/**
 * Inflação em que um papel prefixado e um IPCA+ rendem igual (a "inflação
 * implícita"): `(1 + pré) = (1 + IPCA) × (1 + juro real)`.
 */
export function breakevenInflationPct(
	prefixedPct: number,
	ipcaPlusRealPct: number
): number {
	return ((1 + prefixedPct / 100) / (1 + ipcaPlusRealPct / 100) - 1) * 100;
}
