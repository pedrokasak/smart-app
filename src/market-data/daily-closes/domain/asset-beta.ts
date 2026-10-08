/**
 * Beta de um ativo contra o mercado, a partir de fechamentos diários (TRA-251).
 *
 * Mesmas duas armadilhas do beta da carteira (`portfolio/history/benchmark-metrics`):
 * pareamento por DATA (um feriado que só um lado tem desloca a série inteira
 * se casar por posição) e mínimo de observações.
 *
 * Uma terceira é só desta fonte. O COTAHIST traz o preço do pregão sem ajuste:
 * um desdobramento 1:10 aparece como queda de 90% de um dia para o outro, e
 * um único dia assim domina a covariância e produz um beta "confiante e
 * errado". Dias com retorno absoluto acima de `maxAbsReturn` em qualquer dos
 * lados saem do cálculo — menos dados, mas nenhum número inventado.
 */

export interface Close {
	date: string;
	close: number;
}

export interface BetaOptions {
	/** Pregões usados (os mais recentes). 252 = um ano. */
	window: number;
	/** Pares válidos mínimos; abaixo disso devolve `null`. */
	minObservations: number;
	/** Retorno diário acima disso é tratado como evento corporativo. */
	maxAbsReturn: number;
}

export const DEFAULT_BETA_OPTIONS: BetaOptions = {
	window: 252,
	minObservations: 120,
	maxAbsReturn: 0.4,
};

export interface BetaResult {
	beta: number | null;
	/** Pares de retornos efetivamente usados. */
	observations: number;
	/** Último pregão considerado. */
	asOf: string | null;
	unavailable: 'insufficient_observations' | 'benchmark_no_variance' | null;
}

function pairedReturns(
	asset: Close[],
	market: Close[],
	maxAbsReturn: number
): { date: string; asset: number; market: number }[] {
	const marketByDate = new Map(
		market.map((point) => [point.date, point.close])
	);
	const common = [...asset]
		.sort((a, b) => a.date.localeCompare(b.date))
		.filter((point) => marketByDate.has(point.date) && point.close > 0);

	const pairs: { date: string; asset: number; market: number }[] = [];
	for (let i = 1; i < common.length; i += 1) {
		const previous = common[i - 1];
		const current = common[i];
		const marketPrevious = marketByDate.get(previous.date)!;
		const marketCurrent = marketByDate.get(current.date)!;
		if (!(marketPrevious > 0) || !(marketCurrent > 0)) continue;

		const assetReturn = current.close / previous.close - 1;
		const marketReturn = marketCurrent / marketPrevious - 1;
		if (
			Math.abs(assetReturn) > maxAbsReturn ||
			Math.abs(marketReturn) > maxAbsReturn
		) {
			continue;
		}
		pairs.push({
			date: current.date,
			asset: assetReturn,
			market: marketReturn,
		});
	}
	return pairs;
}

export function computeAssetBeta(
	asset: Close[],
	market: Close[],
	options: Partial<BetaOptions> = {}
): BetaResult {
	const { window, minObservations, maxAbsReturn } = {
		...DEFAULT_BETA_OPTIONS,
		...options,
	};
	const pairs = pairedReturns(asset, market, maxAbsReturn).slice(-window);
	const asOf = pairs.length ? pairs[pairs.length - 1].date : null;

	if (pairs.length < minObservations) {
		return {
			beta: null,
			observations: pairs.length,
			asOf,
			unavailable: 'insufficient_observations',
		};
	}

	const n = pairs.length;
	const meanAsset = pairs.reduce((sum, p) => sum + p.asset, 0) / n;
	const meanMarket = pairs.reduce((sum, p) => sum + p.market, 0) / n;
	let covariance = 0;
	let variance = 0;
	for (const p of pairs) {
		covariance += (p.asset - meanAsset) * (p.market - meanMarket);
		variance += (p.market - meanMarket) ** 2;
	}
	if (variance === 0) {
		return {
			beta: null,
			observations: n,
			asOf,
			unavailable: 'benchmark_no_variance',
		};
	}

	return {
		beta: Math.round((covariance / variance) * 1e6) / 1e6,
		observations: n,
		asOf,
		unavailable: null,
	};
}
