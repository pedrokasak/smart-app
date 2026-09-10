import { DailyCashFlow } from './cash-flows';

/**
 * Retorno da carteira: decomposição aporte/rendimento, TWR e IRR (TRA-146).
 *
 * ## O problema que estes três resolvem
 *
 * O número principal do dashboard era "P&L (custo médio)", que mistura aporte
 * com desempenho. Com ele ninguém — do iniciante ao gestor — consegue responder
 * a pergunta mais básica: *fui bem, ou só coloquei mais dinheiro?*
 *
 * ## Por que dois retornos, e não um
 *
 * **TWR** neutraliza o efeito de aportes e retiradas. É o único jeito honesto
 * de comparar a carteira com um índice: o IBOV não recebe aporte, então
 * comparar com um retorno contaminado por depósito não significa nada.
 *
 * **IRR** faz o oposto de propósito: pondera pelo dinheiro e pelo momento em
 * que ele entrou. Responde "qual foi o retorno do MEU dinheiro". Quem aportou
 * pesado antes de uma alta tem IRR acima do TWR; quem aportou antes de uma
 * queda, abaixo. A diferença entre os dois é informação — mede o acerto de
 * timing dos aportes — e por isso um não substitui o outro.
 *
 * ## Método escolhido
 *
 * TWR por **encadeamento diário** (Dietz modificado não é usado). Cada dia é um
 * subperíodo: `r = (V_fim - fluxo) / V_início - 1`, e o retorno total é o
 * produto de `(1 + r)`. Encadear diariamente é mais preciso que Dietz quando há
 * fluxo frequente, e a série diária já existe desde TRA-143 — a razão para usar
 * Dietz (não ter valor diário) não se aplica aqui.
 *
 * O fluxo é tratado como ocorrendo no FIM do dia: o dinheiro aportado hoje não
 * teve tempo de render hoje. É a convenção mais conservadora das duas.
 */

export interface DailyValuePoint {
	/** YYYY-MM-DD */
	date: string;
	/** Posição a preço de mercado no fim do dia. */
	totalValue: number;
	/** Custo de aquisição acumulado. */
	investedValue?: number;
	/** false em fim de semana e feriado. */
	tradingDay?: boolean;
}

export interface ContributionBreakdown {
	/** Valor atual da carteira, a mercado. */
	currentValue: number;
	/** Dinheiro líquido que o usuário colocou. */
	contributed: number;
	/** Quanto o mercado rendeu, em reais. */
	marketGain: number;
	/** Rendimento sobre o aportado, em %. `null` sem aporte. */
	marketGainPct: number | null;
}

export interface TwrResult {
	/** Retorno time-weighted do período, em fração (0.12 = 12%). */
	twr: number | null;
	/** Subperíodos efetivamente encadeados. */
	periods: number;
	/** Dias descartados por não haver valor inicial com que comparar. */
	skipped: number;
}

const round2 = (value: number): number => Number(value.toFixed(2));
const round6 = (value: number): number => Number(value.toFixed(6));

/**
 * "Dos seus R$ 50.000, você depositou R$ 45.000 e o mercado rendeu R$ 5.000."
 *
 * O número mais esclarecedor que existe para quem começa, e o único da lista
 * que serve aos três perfis sem mudar de forma — só de apresentação.
 */
export function decomposeContribution(params: {
	currentValue: number;
	netContribution: number;
}): ContributionBreakdown {
	const currentValue = Number(params.currentValue) || 0;
	const contributed = Number(params.netContribution) || 0;
	const marketGain = currentValue - contributed;

	return {
		currentValue: round2(currentValue),
		contributed: round2(contributed),
		marketGain: round2(marketGain),
		// Retirada líquida maior que o valor atual torna a base negativa e a
		// porcentagem sem sentido — melhor não reportar do que reportar torto.
		marketGainPct: contributed > 0 ? round6(marketGain / contributed) : null,
	};
}

/**
 * TWR por encadeamento diário.
 *
 * Dias sem valor inicial positivo são pulados, não zerados: uma carteira que
 * ainda não existia não teve retorno -100%, ela não teve retorno nenhum.
 */
export interface DatedReturn {
	/** YYYY-MM-DD */
	date: string;
	/** Retorno do dia, em fração. */
	value: number;
}

/**
 * Retornos diários da carteira, ajustados por fluxo.
 *
 * O ajuste é o mesmo do TWR e existe pelo mesmo motivo: sem ele um aporte
 * aparece como um dia de alta enorme. Num retorno acumulado isso infla o
 * número; em covariância com índice, destrói a medida — o beta passaria a
 * medir o calendário de aportes do usuário, não a sensibilidade da carteira.
 *
 * Por isso `computeBeta` e `computeTrackingError` consomem esta função em vez
 * de derivar retorno da variação bruta do valor.
 */
export function computeDailyReturns(params: {
	series: DailyValuePoint[];
	flows: DailyCashFlow[];
	tradingDaysOnly?: boolean;
}): { returns: DatedReturn[]; skipped: number } {
	const tradingDaysOnly = params.tradingDaysOnly !== false;

	const series = [...(params.series || [])]
		.filter((point) => (tradingDaysOnly ? point.tradingDay !== false : true))
		.sort((a, b) => a.date.localeCompare(b.date));

	const flowByDay = new Map<string, number>();
	for (const flow of params.flows || []) {
		flowByDay.set(flow.date, (flowByDay.get(flow.date) || 0) + flow.flow);
	}

	const returns: DatedReturn[] = [];
	let skipped = 0;

	for (let i = 1; i < series.length; i += 1) {
		const previous = Number(series[i - 1].totalValue) || 0;
		const current = Number(series[i].totalValue) || 0;

		if (previous <= 0) {
			skipped += 1;
			continue;
		}

		// Fluxo no fim do dia: o aporte de hoje não rendeu hoje.
		const flow = flowByDay.get(series[i].date) || 0;
		returns.push({
			date: series[i].date,
			value: (current - flow) / previous - 1,
		});
	}

	return { returns, skipped };
}

export function computeTwr(params: {
	series: DailyValuePoint[];
	flows: DailyCashFlow[];
	/** Excluir fim de semana e feriado. Padrão: true. */
	tradingDaysOnly?: boolean;
}): TwrResult {
	const { returns, skipped } = computeDailyReturns(params);

	if (returns.length === 0) {
		return { twr: null, periods: 0, skipped };
	}

	let growth = 1;
	for (const point of returns) {
		growth *= 1 + point.value;
	}

	return { twr: round6(growth - 1), periods: returns.length, skipped };
}

/** Anualiza um retorno acumulado observado em `days` dias corridos. */
export function annualize(totalReturn: number, days: number): number | null {
	if (!Number.isFinite(totalReturn) || days <= 0) return null;
	// Base 1 + r não pode ser negativa: perda total não tem raiz real.
	const base = 1 + totalReturn;
	if (base <= 0) return null;
	return round6(Math.pow(base, 365 / days) - 1);
}

export interface IrrCashFlow {
	/** YYYY-MM-DD */
	date: string;
	/**
	 * Positivo = dinheiro que saiu do bolso para a carteira.
	 * O valor final da carteira entra como fluxo NEGATIVO na data final.
	 */
	amount: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function npv(rate: number, flows: IrrCashFlow[], start: number): number {
	let total = 0;
	for (const flow of flows) {
		const days =
			(new Date(`${flow.date}T00:00:00.000Z`).getTime() - start) / MS_PER_DAY;
		total += flow.amount / Math.pow(1 + rate, days / 365);
	}
	return total;
}

/**
 * IRR anualizada com datas irregulares (XIRR), por bisseção.
 *
 * Bisseção em vez de Newton-Raphson de propósito: Newton converge mais rápido
 * mas diverge com fluxos mal comportados, e devolver um número absurdo é pior
 * que devolver `null`. Aqui o intervalo é limitado e a falha é explícita.
 *
 * Convenção de sinal: aportes positivos, valor final da carteira negativo.
 */
export function computeXirr(
	flows: IrrCashFlow[],
	options?: { maxIterations?: number; tolerance?: number }
): number | null {
	const valid = (flows || [])
		.filter((f) => f && Number.isFinite(Number(f.amount)))
		.map((f) => ({ date: f.date, amount: Number(f.amount) }))
		.sort((a, b) => a.date.localeCompare(b.date));

	if (valid.length < 2) return null;

	// Sem sinais opostos não existe raiz: ou só entrou dinheiro, ou só saiu.
	const hasPositive = valid.some((f) => f.amount > 0);
	const hasNegative = valid.some((f) => f.amount < 0);
	if (!hasPositive || !hasNegative) return null;

	const start = new Date(`${valid[0].date}T00:00:00.000Z`).getTime();
	if (!Number.isFinite(start)) return null;

	const maxIterations = options?.maxIterations ?? 200;
	const tolerance = options?.tolerance ?? 1e-7;

	// -99,9% a +1000% ao ano. Fora disso o resultado não é informação útil.
	let low = -0.999;
	let high = 10;

	let npvLow = npv(low, valid, start);
	let npvHigh = npv(high, valid, start);

	// Sem troca de sinal nos extremos a raiz não está no intervalo.
	if (npvLow * npvHigh > 0) return null;

	for (let i = 0; i < maxIterations; i += 1) {
		const mid = (low + high) / 2;
		const npvMid = npv(mid, valid, start);

		if (Math.abs(npvMid) < tolerance || high - low < tolerance) {
			return round6(mid);
		}

		if (npvLow * npvMid < 0) {
			high = mid;
			npvHigh = npvMid;
		} else {
			low = mid;
			npvLow = npvMid;
		}
	}

	return round6((low + high) / 2);
}
