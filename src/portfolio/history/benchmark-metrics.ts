import { DatedReturn } from './returns';

/**
 * Beta e tracking error contra um índice de referência (TRA-141, lote 2).
 *
 * ## Por que só agora
 *
 * Estas duas exibiam `'—'` fixo no dashboard e foram removidas em TRA-145. O
 * motivo era real: exigem retornos diários da carteira pareados dia-a-dia com
 * o índice, e a série disponível era reconstruída das negociações — achatada
 * entre trades. Calcular covariância sobre ela produziria número confiante e
 * errado.
 *
 * TRA-143 corrigiu a série (o snapshot gravava custo, não valor de mercado), e
 * com isso as duas passaram a ser calculáveis. O cálculo em si nunca existiu no
 * projeto: o `'—'` era literal, não resultado de conta que falhava.
 *
 * ## Duas armadilhas que este módulo evita
 *
 * **Retorno bruto.** Os retornos da carteira precisam ser ajustados por fluxo
 * (ver `computeDailyReturns`). Sem isso, o beta mediria o calendário de aportes
 * do usuário em vez da sensibilidade da carteira ao índice.
 *
 * **Pareamento por índice de array.** Só entram no cálculo dias presentes nas
 * DUAS séries, casados por data. Alinhar por posição parece funcionar até o
 * primeiro feriado que só um dos lados tem — e então todo o resto da série fica
 * deslocado em um dia, produzindo um beta plausível e completamente errado.
 */

/** Mínimo de observações para o número significar algo. */
export const MIN_OBSERVATIONS = 20;

export interface BenchmarkMetricsResult {
	beta: number | null;
	/** Tracking error anualizado, em fração. */
	trackingError: number | null;
	/** Correlação com o índice, útil para julgar a confiabilidade do beta. */
	correlation: number | null;
	/** Dias efetivamente pareados entre as duas séries. */
	observations: number;
	/**
	 * Beta só nos dias de alta / de queda do índice (nota "up 0,88 / down
	 * 0,61" da barra quant do handoff). Carteira defensiva de verdade tem o
	 * down menor que o up. `null` com menos de 10 dias em cada lado.
	 */
	upBeta: number | null;
	downBeta: number | null;
	/** Retorno acumulado da carteira nos dias pareados, em fração. */
	portfolioReturn: number | null;
	/** Retorno acumulado do índice nos mesmos dias, em fração. */
	benchmarkReturn: number | null;
	/**
	 * Alpha de Jensen sem taxa livre de risco, como no GLOSSARY do handoff:
	 * retorno da carteira − beta × retorno do índice.
	 */
	alpha: number | null;
	/** Por que não deu, quando algum resultado é null. */
	unavailable: 'insufficient_observations' | 'benchmark_no_variance' | null;
}

const TRADING_DAYS_PER_YEAR = 252;

const round6 = (value: number): number => Number(value.toFixed(6));

const mean = (values: number[]): number =>
	values.reduce((sum, value) => sum + value, 0) / values.length;

/** Metade do mínimo geral: cada lado (alta/queda) tem cerca de metade dos dias. */
const MIN_SIDE_OBSERVATIONS = MIN_OBSERVATIONS / 2;

/** Beta amostral de `a` contra `b`; `null` sem variação ou com poucos dias. */
function betaOf(
	a: number[],
	b: number[],
	minObservations: number
): number | null {
	if (a.length < minObservations) return null;
	const meanA = mean(a);
	const meanB = mean(b);
	let covariance = 0;
	let variance = 0;
	for (let i = 0; i < a.length; i += 1) {
		covariance += (a[i] - meanA) * (b[i] - meanB);
		variance += (b[i] - meanB) ** 2;
	}
	return variance > 0 ? covariance / variance : null;
}

const compound = (values: number[]): number =>
	values.reduce((growth, value) => growth * (1 + value), 1) - 1;

const EMPTY_EXTENDED = {
	upBeta: null,
	downBeta: null,
	portfolioReturn: null,
	benchmarkReturn: null,
	alpha: null,
} as const;

/**
 * Pareia duas séries de retorno por DATA, não por posição.
 *
 * Devolve arrays alinhados contendo só as datas presentes em ambas.
 */
export function pairByDate(
	a: DatedReturn[],
	b: DatedReturn[]
): { a: number[]; b: number[]; dates: string[] } {
	const bByDate = new Map(b.map((point) => [point.date, point.value]));

	const pairedA: number[] = [];
	const pairedB: number[] = [];
	const dates: string[] = [];

	for (const point of [...a].sort((x, y) => x.date.localeCompare(y.date))) {
		const counterpart = bByDate.get(point.date);
		if (counterpart === undefined) continue;
		if (!Number.isFinite(point.value) || !Number.isFinite(counterpart))
			continue;
		pairedA.push(point.value);
		pairedB.push(counterpart);
		dates.push(point.date);
	}

	return { a: pairedA, b: pairedB, dates };
}

/** Converte uma série de fechamentos em retornos diários. */
export function closesToReturns(
	closes: { date: string; close: number }[]
): DatedReturn[] {
	const sorted = [...(closes || [])]
		.filter((point) => Number.isFinite(point?.close) && point.close > 0)
		.sort((a, b) => a.date.localeCompare(b.date));

	const returns: DatedReturn[] = [];
	for (let i = 1; i < sorted.length; i += 1) {
		returns.push({
			date: sorted[i].date,
			value: sorted[i].close / sorted[i - 1].close - 1,
		});
	}
	return returns;
}

export function computeBenchmarkMetrics(
	portfolioReturns: DatedReturn[],
	benchmarkReturns: DatedReturn[]
): BenchmarkMetricsResult {
	const paired = pairByDate(portfolioReturns || [], benchmarkReturns || []);
	const observations = paired.dates.length;

	const empty: BenchmarkMetricsResult = {
		beta: null,
		trackingError: null,
		correlation: null,
		observations,
		...EMPTY_EXTENDED,
		unavailable: 'insufficient_observations',
	};

	// Beta sobre poucos dias é ruído com aparência de medida.
	if (observations < MIN_OBSERVATIONS) return empty;

	const meanPortfolio = mean(paired.a);
	const meanBenchmark = mean(paired.b);

	let covariance = 0;
	let benchmarkVariance = 0;
	let portfolioVariance = 0;

	for (let i = 0; i < observations; i += 1) {
		const dp = paired.a[i] - meanPortfolio;
		const db = paired.b[i] - meanBenchmark;
		covariance += dp * db;
		benchmarkVariance += db * db;
		portfolioVariance += dp * dp;
	}

	// Amostral (n-1): a série é uma amostra do comportamento, não a população.
	const denominator = observations - 1;
	covariance /= denominator;
	benchmarkVariance /= denominator;
	portfolioVariance /= denominator;

	// Índice sem variação no período: dividir por zero daria Infinity.
	if (benchmarkVariance <= 0) {
		return {
			beta: null,
			trackingError: null,
			correlation: null,
			observations,
			...EMPTY_EXTENDED,
			unavailable: 'benchmark_no_variance',
		};
	}

	const beta = covariance / benchmarkVariance;

	// Tracking error: desvio-padrão da DIFERENÇA de retorno, anualizado.
	const differences = paired.a.map((value, i) => value - paired.b[i]);
	const meanDifference = mean(differences);
	const diffVariance =
		differences.reduce((sum, value) => sum + (value - meanDifference) ** 2, 0) /
		denominator;
	const trackingError =
		Math.sqrt(diffVariance) * Math.sqrt(TRADING_DAYS_PER_YEAR);

	const correlationDenominator = Math.sqrt(
		portfolioVariance * benchmarkVariance
	);
	const correlation =
		correlationDenominator > 0 ? covariance / correlationDenominator : null;

	const upIndexes = paired.b.flatMap((value, i) => (value > 0 ? [i] : []));
	const downIndexes = paired.b.flatMap((value, i) => (value < 0 ? [i] : []));
	const upBeta = betaOf(
		upIndexes.map((i) => paired.a[i]),
		upIndexes.map((i) => paired.b[i]),
		MIN_SIDE_OBSERVATIONS
	);
	const downBeta = betaOf(
		downIndexes.map((i) => paired.a[i]),
		downIndexes.map((i) => paired.b[i]),
		MIN_SIDE_OBSERVATIONS
	);

	const portfolioReturn = compound(paired.a);
	const benchmarkReturn = compound(paired.b);
	const alpha = portfolioReturn - beta * benchmarkReturn;

	return {
		beta: round6(beta),
		trackingError: round6(trackingError),
		correlation: correlation === null ? null : round6(correlation),
		observations,
		upBeta: upBeta === null ? null : round6(upBeta),
		downBeta: downBeta === null ? null : round6(downBeta),
		portfolioReturn: round6(portfolioReturn),
		benchmarkReturn: round6(benchmarkReturn),
		alpha: round6(alpha),
		unavailable: null,
	};
}
