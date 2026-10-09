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
	/** Símbolos sem cotação no dia: valem pelo custo, não pelo mercado. */
	staleSymbols?: string[];
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
	/** Janela de fato medida: do ponto-base ao último retorno encadeado. */
	measuredFrom: string | null;
	measuredTo: string | null;
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

/** Diferença de centavo entre valor e custo ainda é "tudo a custo". */
const COST_TOLERANCE = 0.01;

/**
 * Ponto sem informação de mercado: há símbolo sem cotação e o valor é igual ao
 * custo. É o que a reconstrução grava quando não acha fechamento (TRA-279).
 * Medir retorno sobre ele dá 0% "falso" — ou, na transição para o valor a
 * mercado, a valorização inteira desde a compra num dia só.
 */
export function isCostOnlyPoint(point: DailyValuePoint): boolean {
	return (
		(point.staleSymbols?.length ?? 0) > 0 &&
		point.investedValue != null &&
		Math.abs(Number(point.totalValue) - Number(point.investedValue)) <=
			COST_TOLERANCE
	);
}

const staleKey = (point: DailyValuePoint): string =>
	[...(point.staleSymbols ?? [])].sort().join(',');

/**
 * Se a variação entre dois pontos pode ser lida como retorno. Não pode quando
 * o que mudou foi a fotografia, não o mercado:
 *
 * - valor zerado ou negativo (snapshot com a carteira vazia no meio de uma
 *   reimportação): um único dia assim levava o TWR encadeado a -100% para
 *   sempre, porque tudo multiplicado por zero continua zero;
 * - um dos pontos sem custo registrado (linha anterior à TRA-143 ou avulsa):
 *   não dá para saber se o valor mudou por mercado ou por composição;
 * - mudou o conjunto de símbolos sem cotação: ativo que passou a ter cotação
 *   salta do custo para o mercado, e ativo que entrou sem cotação entra pelo
 *   custo — reavaliação, não rendimento;
 * - o custo mudou sem negociação no dia: posição entrou ou saiu por fora das
 *   notas (relatório consolidado, ajuste manual, sincronização).
 */
function comparable(
	previous: DailyValuePoint,
	current: DailyValuePoint,
	hasTradeFlow: boolean
): boolean {
	if (!(Number(previous.totalValue) > 0) || !(Number(current.totalValue) > 0)) {
		return false;
	}
	if ((previous.investedValue == null) !== (current.investedValue == null)) {
		return false;
	}
	if (staleKey(previous) !== staleKey(current)) return false;
	if (
		!hasTradeFlow &&
		previous.investedValue != null &&
		current.investedValue != null &&
		Math.abs(Number(current.investedValue) - Number(previous.investedValue)) >
			COST_TOLERANCE
	) {
		return false;
	}
	return true;
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
 *
 * Só encadeia dias comparáveis (ver `comparable`). O dia que não é comparável
 * não vira retorno nenhum: a série segue do ponto seguinte, como se a medição
 * recomeçasse ali. Perder um dia de mercado é melhor que inventar um.
 */
export function computeDailyReturns(params: {
	series: DailyValuePoint[];
	flows: DailyCashFlow[];
	tradingDaysOnly?: boolean;
}): { returns: DatedReturn[]; skipped: number; baseDate: string | null } {
	const tradingDaysOnly = params.tradingDaysOnly !== false;

	const series = [...(params.series || [])]
		.filter((point) => (tradingDaysOnly ? point.tradingDay !== false : true))
		.filter((point) => !isCostOnlyPoint(point))
		.sort((a, b) => a.date.localeCompare(b.date));

	const flowByDay = new Map<string, number>();
	for (const flow of params.flows || []) {
		flowByDay.set(flow.date, (flowByDay.get(flow.date) || 0) + flow.flow);
	}

	const returns: DatedReturn[] = [];
	let skipped = 0;
	let baseDate: string | null = null;

	for (let i = 1; i < series.length; i += 1) {
		const previous = series[i - 1];
		const current = series[i];
		// Fluxo no fim do dia: o aporte de hoje não rendeu hoje.
		const flow = flowByDay.get(current.date) || 0;

		if (!comparable(previous, current, flow !== 0)) {
			skipped += 1;
			continue;
		}

		const value =
			(Number(current.totalValue) - flow) / Number(previous.totalValue) - 1;
		// Perder tudo num dia sem retirada não é mercado, é dado faltando.
		if (!(value > -1)) {
			skipped += 1;
			continue;
		}

		if (baseDate === null) baseDate = previous.date;
		returns.push({ date: current.date, value });
	}

	return { returns, skipped, baseDate };
}

/**
 * TWR acumulado dia a dia, para desenhar a curva de retorno da carteira.
 *
 * Começa com a base (0) em `baseDate`: sem ela a curva já nasce no retorno do
 * primeiro dia e o cliente, ao recortar a janela, não tem de onde rebasear.
 */
export function cumulativeReturns(
	returns: DatedReturn[],
	baseDate: string | null
): DatedReturn[] {
	if (returns.length === 0) return [];
	const out: DatedReturn[] = baseDate ? [{ date: baseDate, value: 0 }] : [];
	let growth = 1;
	for (const point of returns) {
		growth *= 1 + point.value;
		out.push({ date: point.date, value: round6(growth - 1) });
	}
	return out;
}

export function computeTwr(params: {
	series: DailyValuePoint[];
	flows: DailyCashFlow[];
	/** Excluir fim de semana e feriado. Padrão: true. */
	tradingDaysOnly?: boolean;
}): TwrResult {
	const { returns, skipped, baseDate } = computeDailyReturns(params);

	if (returns.length === 0) {
		return {
			twr: null,
			periods: 0,
			skipped,
			measuredFrom: null,
			measuredTo: null,
		};
	}

	let growth = 1;
	for (const point of returns) {
		growth *= 1 + point.value;
	}

	return {
		twr: round6(growth - 1),
		periods: returns.length,
		skipped,
		measuredFrom: baseDate,
		measuredTo: returns[returns.length - 1].date,
	};
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
