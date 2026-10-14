/**
 * Expectativa de inflação do mercado (Focus, BACEN): a mediana das projeções
 * das instituições que respondem à pesquisa. Serve para simular o futuro;
 * para medir o passado vale o IPCA realizado.
 */
export interface InflationExpectations {
	/** Data da pesquisa Focus (YYYY-MM-DD). */
	surveyDate: string;
	/** Mediana do IPCA dos próximos 12 meses (série suavizada), % no período. */
	next12mPct: number;
	/** Mediana do IPCA por ano-calendário, % no ano. */
	byYear: Record<number, number>;
	/** Procedência para exibir junto do número. */
	source: string;
}

const DAYS_PER_YEAR = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

const utc = (iso: string) => {
	const [year, month, day] = iso.split('-').map(Number);
	return Date.UTC(year, month - 1, day);
};

/**
 * IPCA anual equivalente para aplicar `days` dias a partir de `startIso`.
 *
 * Os primeiros 12 meses usam a projeção "12 meses à frente", que já começa
 * hoje. Dali em diante, cada dia usa a mediana do seu ano-calendário; ano sem
 * projeção (além do horizonte do Focus) repete o último ano publicado. O
 * resultado é a média geométrica, o mesmo que compor ano a ano.
 */
export function expectedAnnualIpcaPct(
	expectations: InflationExpectations,
	startIso: string,
	days: number
): number {
	if (!(days > 0)) return expectations.next12mPct;

	const years = Object.keys(expectations.byYear)
		.map(Number)
		.sort((a, b) => a - b);
	const lastYear = years.at(-1);
	const rateForYear = (year: number) =>
		expectations.byYear[year] ??
		(lastYear !== undefined && year > lastYear
			? expectations.byYear[lastYear]
			: expectations.next12mPct);

	const firstSegment = Math.min(days, DAYS_PER_YEAR);
	let logGrowth =
		(firstSegment / DAYS_PER_YEAR) *
		Math.log(1 + expectations.next12mPct / 100);

	let cursor = utc(startIso) + firstSegment * DAY_MS;
	let remaining = days - firstSegment;
	while (remaining > 0) {
		const year = new Date(cursor).getUTCFullYear();
		const yearEnd = Date.UTC(year + 1, 0, 1);
		const inYear = Math.min(remaining, Math.round((yearEnd - cursor) / DAY_MS));
		logGrowth +=
			(inYear / DAYS_PER_YEAR) * Math.log(1 + rateForYear(year) / 100);
		cursor += inYear * DAY_MS;
		remaining -= inYear;
	}

	return (Math.exp((logGrowth * DAYS_PER_YEAR) / days) - 1) * 100;
}
