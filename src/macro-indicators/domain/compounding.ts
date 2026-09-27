/**
 * Aritmética de séries de taxa (`kind: 'RATE'`). Funções puras.
 *
 * Série de taxa acumula por encadeamento: `Π(1 + vᵢ/100) − 1`. Somar
 * subestima — com IPCA de 0,58%, 0,16% e 0,07%, a soma dá 0,8100% e o
 * encadeamento dá 0,8114%. A diferença cresce com o prazo e com a inflação.
 */

export interface RatePoint {
	/** YYYY-MM-DD; em série mensal, o dia 01 do mês de referência. */
	date: string;
	/** Variação do período em PERCENTUAL (0,58 = 0,58%). */
	value: number;
}

/** Acumulado de taxas em percentual, por encadeamento. */
export function compoundPercent(ratesPercent: number[]): number {
	const factor = ratesPercent.reduce((acc, rate) => acc * (1 + rate / 100), 1);
	return (factor - 1) * 100;
}

/** Retorno real a partir de nominal e inflação, ambos em FRAÇÃO (0,10 = 10%). */
export function realReturn(nominal: number, inflation: number): number {
	return (1 + nominal) / (1 + inflation) - 1;
}

export interface PeriodInflation {
	/** Inflação acumulada no período, em FRAÇÃO. */
	inflation: number;
	/**
	 * Meses do período ainda sem IPCA publicado (o IBGE divulga por volta do
	 * dia 10 do mês seguinte). Para eles vale o último IPCA publicado — é uma
	 * estimativa, e a resposta declara quantos meses foram estimados.
	 */
	estimatedMonths: number;
	/** Último mês com IPCA publicado usado no cálculo (YYYY-MM-01). */
	lastPublishedMonth: string;
}

function parseUtc(isoDate: string): number {
	return new Date(`${isoDate}T00:00:00.000Z`).getTime();
}

function monthKey(time: number): string {
	const date = new Date(time);
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	return `${date.getUTCFullYear()}-${month}-01`;
}

function nextMonthStart(time: number): number {
	const date = new Date(time);
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

/**
 * Inflação acumulada entre `from` e `to` (fim exclusivo, mesma convenção de
 * um retorno entre duas datas) a partir de uma série MENSAL de taxa.
 *
 * Mês parcial entra pró-rata por dias corridos, de forma geométrica:
 * `(1 + v)^(dias no período / dias do mês)`. Devolve `null` quando não há
 * nenhum IPCA publicado até o início do período.
 */
export function inflationOverPeriod(
	monthly: RatePoint[],
	from: string,
	to: string
): PeriodInflation | null {
	const start = parseUtc(from);
	const end = parseUtc(to);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
		return null;
	}

	const byMonth = new Map(monthly.map((point) => [point.date, point.value]));
	const published = [...byMonth.keys()].sort();
	let lastKnown: { month: string; value: number } | null = null;
	for (const month of published) {
		if (parseUtc(month) > start) break;
		lastKnown = { month, value: byMonth.get(month)! };
	}

	let factor = 1;
	let estimatedMonths = 0;
	let cursor = start;
	while (cursor < end) {
		const key = monthKey(cursor);
		const monthStart = parseUtc(key);
		const monthEnd = nextMonthStart(cursor);
		const sliceEnd = Math.min(monthEnd, end);

		const value = byMonth.get(key);
		if (value !== undefined) {
			lastKnown = { month: key, value };
		} else if (lastKnown) {
			estimatedMonths++;
		} else {
			return null;
		}

		const fraction = (sliceEnd - cursor) / (monthEnd - monthStart);
		factor *= Math.pow(1 + lastKnown.value / 100, fraction);
		cursor = sliceEnd;
	}

	return {
		inflation: factor - 1,
		estimatedMonths,
		lastPublishedMonth: lastKnown!.month,
	};
}
