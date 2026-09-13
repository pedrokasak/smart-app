import { MIN_OBSERVATIONS, pairByDate } from './benchmark-metrics';
import { DatedReturn } from './returns';

/**
 * Sharpe, VaR histórico e máximo drawdown da carteira (TRA-141).
 *
 * São os três números de risco que o protótipo App do handoff mostra no nível
 * avançado (`kpisAdv` e barra `quant`) e que o produto ainda não calculava — ou
 * calculava no navegador, sobre a série BRUTA de valor.
 *
 * ## Por que no servidor, sobre retorno ajustado por fluxo
 *
 * O Sharpe e o drawdown do dashboard eram calculados sobre `totalValue` dia a
 * dia. Um resgate de 30% aparecia como queda de 30%: drawdown fabricado. Um
 * aporte grande aparecia como alta: Sharpe inflado. Aqui a entrada é a mesma
 * série de retornos ajustados por fluxo que alimenta TWR e beta, e o erro some.
 */

const TRADING_DAYS_PER_YEAR = 252;

const round6 = (value: number): number => Number(value.toFixed(6));
const round2 = (value: number): number => Number(value.toFixed(2));

const sortByDate = (returns: DatedReturn[]): DatedReturn[] =>
	[...(returns || [])]
		.filter((point) => Number.isFinite(point?.value))
		.sort((a, b) => a.date.localeCompare(b.date));

const mean = (values: number[]): number =>
	values.reduce((sum, value) => sum + value, 0) / values.length;

const sampleStdDev = (values: number[]): number => {
	const average = mean(values);
	const variance =
		values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
		(values.length - 1);
	return Math.sqrt(variance);
};

// ── Sharpe ──────────────────────────────────────────────────────────────────

export interface SharpeResult {
	/** Anualizado (× √252). */
	sharpe: number | null;
	/** Taxa livre de risco anual efetiva no mesmo período, em fração. */
	riskFreeAnnual: number | null;
	observations: number;
}

/**
 * Sharpe com o CDI diário como taxa livre de risco, pareado por data.
 *
 * `riskFreeDaily` vem em FRAÇÃO por dia (0.000397), não no percentual do
 * BACEN — a conversão é de quem busca a série.
 */
export function computeSharpe(
	portfolioReturns: DatedReturn[],
	riskFreeDaily: DatedReturn[]
): SharpeResult {
	const paired = pairByDate(portfolioReturns || [], riskFreeDaily || []);
	const observations = paired.dates.length;

	if (observations < MIN_OBSERVATIONS) {
		return { sharpe: null, riskFreeAnnual: null, observations };
	}

	const growth = paired.b.reduce((acc, rate) => acc * (1 + rate), 1);
	const riskFreeAnnual = round6(
		growth ** (TRADING_DAYS_PER_YEAR / observations) - 1
	);

	const excess = paired.a.map((value, i) => value - paired.b[i]);
	const deviation = sampleStdDev(excess);
	if (!(deviation > 0)) {
		return { sharpe: null, riskFreeAnnual, observations };
	}

	const sharpe = (mean(excess) / deviation) * Math.sqrt(TRADING_DAYS_PER_YEAR);
	return {
		sharpe: Number.isFinite(sharpe) ? round6(sharpe) : null,
		riskFreeAnnual,
		observations,
	};
}

// ── VaR histórico ───────────────────────────────────────────────────────────

export interface HistoricalVarResult {
	/** Perda do percentil, em fração positiva (0.032 = 3,2%). */
	varPct: number | null;
	/** Mesma perda em reais sobre o patrimônio atual. */
	amount: number | null;
	/** Média das perdas além do VaR (expected shortfall), em fração positiva. */
	cvarPct: number | null;
	cvarAmount: number | null;
	horizonDays: number;
	confidence: number;
	/** Janelas de `horizonDays` pregões efetivamente avaliadas. */
	windows: number;
}

/** Quantil com interpolação linear entre os vizinhos (método 7 do R). */
export function quantile(sortedAscending: number[], q: number): number {
	const position = (sortedAscending.length - 1) * q;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	if (lower === upper) return sortedAscending[lower];
	const weight = position - lower;
	return (
		sortedAscending[lower] * (1 - weight) + sortedAscending[upper] * weight
	);
}

/**
 * VaR histórico: percentil da distribuição de retornos acumulados em janelas
 * de `horizonDays` pregões, aplicado ao patrimônio (GLOSSARY `var` do
 * handoff: "percentil 5% da distribuição de retornos em 21 dias × patrimônio").
 *
 * Janelas sobrepostas, não √21 × VaR diário: a regra da raiz supõe retornos
 * normais e independentes, e é exatamente nas quedas encadeadas que ela erra.
 */
export function computeHistoricalVar(
	returns: DatedReturn[],
	params: { portfolioValue: number; horizonDays?: number; confidence?: number }
): HistoricalVarResult {
	const horizonDays = params.horizonDays ?? 21;
	const confidence = params.confidence ?? 0.95;
	const values = sortByDate(returns).map((point) => point.value);

	const windowReturns: number[] = [];
	for (let start = 0; start + horizonDays <= values.length; start += 1) {
		let growth = 1;
		for (let i = start; i < start + horizonDays; i += 1) {
			growth *= 1 + values[i];
		}
		windowReturns.push(growth - 1);
	}

	const empty: HistoricalVarResult = {
		varPct: null,
		amount: null,
		cvarPct: null,
		cvarAmount: null,
		horizonDays,
		confidence,
		windows: windowReturns.length,
	};
	// Percentil 5% de 20 janelas já é o pior ponto: menos que isso é anedota.
	if (windowReturns.length < MIN_OBSERVATIONS) return empty;

	const sorted = [...windowReturns].sort((a, b) => a - b);
	const threshold = quantile(sorted, 1 - confidence);
	const tail = sorted.filter((value) => value <= threshold);

	// Carteira que nunca perdeu em 21 dias não tem VaR negativo: tem VaR zero.
	const varPct = round6(Math.max(0, -threshold));
	const cvarPct = round6(Math.max(0, -mean(tail)));
	const value = Math.max(0, Number(params.portfolioValue) || 0);

	return {
		varPct,
		amount: round2(varPct * value),
		cvarPct,
		cvarAmount: round2(cvarPct * value),
		horizonDays,
		confidence,
		windows: windowReturns.length,
	};
}

// ── Máximo drawdown ─────────────────────────────────────────────────────────

export interface DrawdownResult {
	/** Maior queda topo-fundo, em fração negativa (-0.142). 0 sem queda. */
	maxDrawdown: number | null;
	peakDate: string | null;
	troughDate: string | null;
	/** Pregões entre o topo e o fundo. */
	durationDays: number | null;
	/** Primeiro pregão que voltou ao topo; `null` se ainda não recuperou. */
	recoveryDate: string | null;
}

/**
 * Drawdown sobre o índice de riqueza dos retornos ajustados por fluxo — um
 * resgate não é queda, um aporte não é recuperação.
 */
export function computeDrawdown(returns: DatedReturn[]): DrawdownResult {
	const sorted = sortByDate(returns);
	if (sorted.length < 2) {
		return {
			maxDrawdown: null,
			peakDate: null,
			troughDate: null,
			durationDays: null,
			recoveryDate: null,
		};
	}

	// Índice de riqueza começa em 1 no dia anterior ao primeiro retorno
	// (posição -1). Um topo em -1 é "o começo da série".
	const wealth: number[] = [];
	let level = 1;
	for (const point of sorted) {
		level *= 1 + point.value;
		wealth.push(level);
	}

	let peakValue = 1;
	let peakIndex = -1;
	let maxDrawdown = 0;
	let worstPeakIndex = -1;
	let worstPeakValue = 1;
	let troughIndex = -1;

	for (let i = 0; i < wealth.length; i += 1) {
		if (wealth[i] > peakValue) {
			peakValue = wealth[i];
			peakIndex = i;
		}
		const drawdown = wealth[i] / peakValue - 1;
		if (drawdown < maxDrawdown) {
			maxDrawdown = drawdown;
			troughIndex = i;
			worstPeakIndex = peakIndex;
			worstPeakValue = peakValue;
		}
	}

	if (troughIndex < 0) {
		return {
			maxDrawdown: 0,
			peakDate: null,
			troughDate: null,
			durationDays: null,
			recoveryDate: null,
		};
	}

	let recoveryDate: string | null = null;
	for (let i = troughIndex + 1; i < wealth.length; i += 1) {
		if (wealth[i] >= worstPeakValue) {
			recoveryDate = sorted[i].date;
			break;
		}
	}

	return {
		maxDrawdown: round6(maxDrawdown),
		// Topo no começo da série: a data é a do primeiro retorno observado.
		peakDate: sorted[Math.max(0, worstPeakIndex)].date,
		troughDate: sorted[troughIndex].date,
		durationDays: troughIndex - worstPeakIndex,
		recoveryDate,
	};
}
