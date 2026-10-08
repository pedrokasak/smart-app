import { MIN_OBSERVATIONS, pairByDate } from './benchmark-metrics';
import { DatedReturn } from './returns';

/**
 * Métricas de performance para os níveis intermediário e avançado (TRA-274).
 *
 * Complementa `risk-metrics` (Sharpe, VaR, drawdown) e `benchmark-metrics`
 * (beta, tracking error). Mesmas regras daqueles módulos:
 *
 * - **Entrada é retorno ajustado por fluxo.** Aporte não é ganho, resgate não é
 *   perda; sem isso, Sortino e captura mediriam o calendário de aportes.
 * - **Pareamento por data**, nunca por posição de array.
 * - **Mínimo de observações.** Abaixo dele a métrica é `null`, e a tela não
 *   mostra — número sobre poucos dias é ruído com cara de medida.
 */

const TRADING_DAYS_PER_YEAR = 252;
/** Cada lado (alta/queda do índice) tem cerca de metade dos dias. */
const MIN_SIDE_OBSERVATIONS = MIN_OBSERVATIONS / 2;

const round6 = (value: number): number => Number(value.toFixed(6));

const mean = (values: number[]): number =>
	values.reduce((sum, value) => sum + value, 0) / values.length;

const sampleStdDev = (values: number[]): number => {
	const average = mean(values);
	return Math.sqrt(
		values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
			(values.length - 1)
	);
};

const compound = (values: number[]): number =>
	values.reduce((growth, value) => growth * (1 + value), 1) - 1;

const finiteOrNull = (value: number): number | null =>
	Number.isFinite(value) ? round6(value) : null;

// ── Sortino ─────────────────────────────────────────────────────────────────

/**
 * Sortino com o CDI como alvo: como o Sharpe, mas o denominador só conta os
 * dias em que a carteira rendeu MENOS que o CDI. Volatilidade para cima não é
 * risco para quem investe — o Sharpe pune as duas, o Sortino não.
 *
 * Desvio de queda sobre TODOS os dias (os acima do alvo entram como zero), que
 * é a definição usual; dividir só pelos dias de queda inflaria o denominador.
 */
export function computeSortino(
	portfolioReturns: DatedReturn[],
	riskFreeDaily: DatedReturn[]
): { sortino: number | null; observations: number } {
	const paired = pairByDate(portfolioReturns || [], riskFreeDaily || []);
	const observations = paired.dates.length;
	if (observations < MIN_OBSERVATIONS) return { sortino: null, observations };

	const excess = paired.a.map((value, i) => value - paired.b[i]);
	const downside = Math.sqrt(
		excess.reduce((sum, value) => sum + Math.min(0, value) ** 2, 0) /
			observations
	);
	// Nunca rendeu abaixo do CDI no período: o Sortino não é infinito, é
	// indefinido — melhor não mostrar que mostrar um número absurdo.
	if (!(downside > 0)) return { sortino: null, observations };

	return {
		sortino: finiteOrNull(
			(mean(excess) / downside) * Math.sqrt(TRADING_DAYS_PER_YEAR)
		),
		observations,
	};
}

// ── Calmar ──────────────────────────────────────────────────────────────────

/**
 * Retorno anual ÷ pior queda. Responde "quanto ganhei por unidade da maior
 * dor que passei". Sem queda no período, é indefinido.
 */
export function computeCalmar(
	annualizedReturn: number | null,
	maxDrawdown: number | null
): number | null {
	if (annualizedReturn === null || maxDrawdown === null) return null;
	if (!(Math.abs(maxDrawdown) > 0)) return null;
	return finiteOrNull(annualizedReturn / Math.abs(maxDrawdown));
}

// ── Captura e information ratio ─────────────────────────────────────────────

export interface RelativePerformanceResult {
	/**
	 * Quanto da alta do índice a carteira acompanhou, em fração (0.88 = 88%).
	 * Média geométrica dos dias de alta da carteira ÷ a do índice.
	 */
	upCapture: number | null;
	/** Idem nos dias de queda. Abaixo de 1 = cai menos que o índice. */
	downCapture: number | null;
	/** Retorno ativo anualizado ÷ tracking error. */
	informationRatio: number | null;
	observations: number;
}

const geometricMean = (values: number[]): number =>
	(1 + compound(values)) ** (1 / values.length) - 1;

export function computeRelativePerformance(
	portfolioReturns: DatedReturn[],
	benchmarkReturns: DatedReturn[]
): RelativePerformanceResult {
	const paired = pairByDate(portfolioReturns || [], benchmarkReturns || []);
	const observations = paired.dates.length;
	const empty: RelativePerformanceResult = {
		upCapture: null,
		downCapture: null,
		informationRatio: null,
		observations,
	};
	if (observations < MIN_OBSERVATIONS) return empty;

	const capture = (predicate: (value: number) => boolean): number | null => {
		const indexes = paired.b.flatMap((value, i) =>
			predicate(value) ? [i] : []
		);
		if (indexes.length < MIN_SIDE_OBSERVATIONS) return null;
		const benchmarkMean = geometricMean(indexes.map((i) => paired.b[i]));
		if (!(Math.abs(benchmarkMean) > 0)) return null;
		return finiteOrNull(
			geometricMean(indexes.map((i) => paired.a[i])) / benchmarkMean
		);
	};

	const active = paired.a.map((value, i) => value - paired.b[i]);
	const activeDeviation = sampleStdDev(active);
	const informationRatio =
		activeDeviation > 0
			? finiteOrNull(
					(mean(active) / activeDeviation) * Math.sqrt(TRADING_DAYS_PER_YEAR)
				)
			: null;

	return {
		upCapture: capture((value) => value > 0),
		downCapture: capture((value) => value < 0),
		informationRatio,
		observations,
	};
}

// ── Rentabilidade por período ───────────────────────────────────────────────

export interface PeriodReturn {
	/** `YYYY-MM` ou `YYYY`. */
	period: string;
	value: number;
	/**
	 * true no primeiro e no último período da série: eles cobrem só parte do
	 * mês/ano (início do histórico e mês corrente). A tela deve dizer isso.
	 */
	partial: boolean;
}

/** Encadeia os retornos diários por mês (`YYYY-MM`) ou por ano (`YYYY`). */
export function periodReturns(
	returns: DatedReturn[],
	granularity: 'month' | 'year'
): PeriodReturn[] {
	const keyLength = granularity === 'month' ? 7 : 4;
	const byPeriod = new Map<string, number[]>();
	for (const point of [...(returns || [])].sort((a, b) =>
		a.date.localeCompare(b.date)
	)) {
		if (!Number.isFinite(point?.value)) continue;
		const key = point.date.slice(0, keyLength);
		const list = byPeriod.get(key) ?? [];
		list.push(point.value);
		byPeriod.set(key, list);
	}

	const keys = [...byPeriod.keys()];
	return keys.map((period, index) => ({
		period,
		value: round6(compound(byPeriod.get(period) as number[])),
		partial: index === 0 || index === keys.length - 1,
	}));
}

export interface PeriodTableRow {
	period: string;
	portfolio: number;
	/** `null` quando a série de comparação não cobre o período. */
	cdi: number | null;
	benchmark: number | null;
	partial: boolean;
}

/**
 * Tabela de rentabilidade da carteira com CDI e índice lado a lado. As séries
 * de comparação são encadeadas SÓ nos dias que a carteira também tem, para os
 * três números de uma linha cobrirem o mesmo intervalo.
 */
export function buildPeriodTable(params: {
	portfolio: DatedReturn[];
	cdi: DatedReturn[];
	benchmark: DatedReturn[];
	granularity: 'month' | 'year';
}): PeriodTableRow[] {
	const portfolioDates = new Set((params.portfolio || []).map((p) => p.date));
	const sameDays = (series: DatedReturn[]) =>
		(series || []).filter((point) => portfolioDates.has(point.date));

	const lookup = (series: DatedReturn[]) =>
		new Map(
			periodReturns(sameDays(series), params.granularity).map((row) => [
				row.period,
				row.value,
			])
		);
	const cdi = lookup(params.cdi);
	const benchmark = lookup(params.benchmark);

	return periodReturns(params.portfolio, params.granularity).map((row) => ({
		period: row.period,
		portfolio: row.value,
		cdi: cdi.get(row.period) ?? null,
		benchmark: benchmark.get(row.period) ?? null,
		partial: row.partial,
	}));
}

export interface MonthStats {
	best: PeriodReturn | null;
	worst: PeriodReturn | null;
	/** Fração de meses positivos, 0-1. */
	positiveShare: number | null;
	/** Meses completos considerados. */
	months: number;
}

/**
 * Melhor mês, pior mês e % de meses positivos — só sobre meses COMPLETOS. O
 * mês corrente pela metade seria "o pior mês" só por ter tido pouco tempo.
 */
export function computeMonthStats(monthly: PeriodReturn[]): MonthStats {
	const complete = (monthly || []).filter((row) => !row.partial);
	if (!complete.length) {
		return { best: null, worst: null, positiveShare: null, months: 0 };
	}
	const sorted = [...complete].sort((a, b) => b.value - a.value);
	return {
		best: sorted[0],
		worst: sorted[sorted.length - 1],
		positiveShare: round6(
			complete.filter((row) => row.value > 0).length / complete.length
		),
		months: complete.length,
	};
}

/**
 * Retorno acumulado dos 12 meses anteriores a cada fim de mês. Tira a sorte da
 * data de início: "rendeu 30% desde o começo" pode ser um único ano bom.
 *
 * Só usa meses completos, então o primeiro ponto aparece no 12º mês fechado.
 */
export function rollingTwelveMonths(
	monthly: PeriodReturn[]
): { period: string; value: number }[] {
	const complete = (monthly || []).filter((row) => !row.partial);
	const out: { period: string; value: number }[] = [];
	for (let end = 11; end < complete.length; end += 1) {
		const window = complete.slice(end - 11, end + 1).map((row) => row.value);
		out.push({ period: complete[end].period, value: round6(compound(window)) });
	}
	return out;
}

// ── Recuperação do drawdown ─────────────────────────────────────────────────

/**
 * Pregões entre o fundo e a volta ao topo anterior. `null` quando não houve
 * queda ou a carteira ainda não recuperou (aí o número relevante é "ainda não
 * recuperou", que a tela diz pela `recoveryDate` nula).
 */
export function computeRecoveryDays(
	returns: DatedReturn[],
	troughDate: string | null,
	recoveryDate: string | null
): number | null {
	if (!troughDate || !recoveryDate) return null;
	return (returns || []).filter(
		(point) => point.date > troughDate && point.date <= recoveryDate
	).length;
}

// ── Concentração ────────────────────────────────────────────────────────────

export interface ConcentrationResult {
	/**
	 * Número efetivo de ativos, 1/Σw². Dez posições com uma pesando 80% valem,
	 * em diversificação, cerca de 1,5 ativo.
	 */
	effectiveAssets: number | null;
	/** Herfindahl-Hirschman, Σw², 0-1. */
	hhi: number | null;
	/** Maior peso, 0-100. */
	topWeightPct: number | null;
	positions: number;
}

export function computeConcentration(
	marketValues: number[]
): ConcentrationResult {
	const values = (marketValues || []).filter((value) => value > 0);
	const total = values.reduce((sum, value) => sum + value, 0);
	if (!(total > 0)) {
		return {
			effectiveAssets: null,
			hhi: null,
			topWeightPct: null,
			positions: 0,
		};
	}
	const weights = values.map((value) => value / total);
	const hhi = weights.reduce((sum, weight) => sum + weight ** 2, 0);
	return {
		effectiveAssets: round6(1 / hhi),
		hhi: round6(hhi),
		topWeightPct: round6(Math.max(...weights) * 100),
		positions: values.length,
	};
}
