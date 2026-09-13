import { closesToReturns, MIN_OBSERVATIONS } from './benchmark-metrics';

/**
 * Contribuição de risco por ativo (TRA-141) — card "Contribuição de risco por
 * ativo" da tela Portfólio do handoff, e GLOSSARY `riskcontrib`:
 * "peso × covariância do ativo com a carteira ÷ variância da carteira".
 *
 * ## Por que importa
 *
 * Peso mede quanto dinheiro está num ativo; contribuição mede quanto do
 * sobe-e-desce vem dele. Um papel com 10% de peso pode responder por 20% do
 * risco se oscila mais e anda junto com o resto. É o número que mostra que a
 * concentração de risco pode ser o dobro da concentração de valor.
 *
 * ## Decomposição de Euler
 *
 * Com pesos fixos, a variância da carteira é Σ w_i · cov(r_i, r_p). Cada
 * parcela dividida pela variância total dá a fatia do ativo, e as fatias somam
 * 100% por construção. Sob normalidade, é também a fatia do VaR paramétrico —
 * por isso o handoff chama de "fatia do VaR".
 *
 * ## Pareamento
 *
 * Só entram datas presentes em TODAS as séries incluídas: um feriado de um
 * lado só deslocaria a covariância (a mesma armadilha do beta).
 */

export interface RiskContributionPosition {
	symbol: string;
	/** Valor a mercado hoje, em reais. */
	marketValue: number;
}

export interface RiskContributionRow {
	symbol: string;
	/** Peso no valor dos ativos incluídos, 0-100. */
	weightPct: number;
	/** Fatia da variância da carteira, 0-100 (pode ser negativa: hedge). */
	sharePct: number;
}

export interface RiskContributionResult {
	/** Ordenado da maior fatia para a menor. */
	rows: RiskContributionRow[];
	/** Pregões em comum usados na conta. */
	observations: number;
	/** Volatilidade anualizada da carteira incluída, em fração. */
	portfolioVolatility: number | null;
	/** Ativos sem série utilizável — declarados, não escondidos. */
	missingSymbols: string[];
	/** Parte do valor que ficou fora da conta, 0-100. */
	excludedValuePct: number;
}

const round2 = (value: number): number => Number(value.toFixed(2));
const round6 = (value: number): number => Number(value.toFixed(6));

export function computeRiskContribution(params: {
	positions: RiskContributionPosition[];
	closesBySymbol: Record<string, { date: string; close: number }[]>;
}): RiskContributionResult {
	const positions = (params.positions || []).filter(
		(position) => Number(position?.marketValue) > 0
	);
	const totalValue = positions.reduce(
		(sum, position) => sum + position.marketValue,
		0
	);

	const series: {
		symbol: string;
		value: number;
		byDate: Map<string, number>;
	}[] = [];
	const missingSymbols: string[] = [];

	for (const position of positions) {
		const returns = closesToReturns(
			params.closesBySymbol?.[position.symbol] || []
		);
		if (returns.length < MIN_OBSERVATIONS) {
			missingSymbols.push(position.symbol);
			continue;
		}
		series.push({
			symbol: position.symbol,
			value: position.marketValue,
			byDate: new Map(returns.map((point) => [point.date, point.value])),
		});
	}

	const includedValue = series.reduce((sum, entry) => sum + entry.value, 0);
	const excludedValuePct =
		totalValue > 0
			? round2(((totalValue - includedValue) / totalValue) * 100)
			: 0;

	const empty: RiskContributionResult = {
		rows: [],
		observations: 0,
		portfolioVolatility: null,
		missingSymbols,
		excludedValuePct,
	};
	// Com um ativo só, ele é 100% do risco: não há decomposição a mostrar.
	if (series.length < 2 || includedValue <= 0) return empty;

	const commonDates = [...series[0].byDate.keys()]
		.filter((date) => series.every((entry) => entry.byDate.has(date)))
		.sort();
	const observations = commonDates.length;
	if (observations < MIN_OBSERVATIONS) return { ...empty, observations };

	const weights = series.map((entry) => entry.value / includedValue);
	const assetReturns = series.map((entry) =>
		commonDates.map((date) => entry.byDate.get(date) as number)
	);
	const portfolioReturns = commonDates.map((_, t) =>
		assetReturns.reduce((sum, returns, i) => sum + weights[i] * returns[t], 0)
	);

	const mean = (values: number[]) =>
		values.reduce((sum, value) => sum + value, 0) / values.length;
	const meanPortfolio = mean(portfolioReturns);
	const denominator = observations - 1;

	const portfolioVariance =
		portfolioReturns.reduce(
			(sum, value) => sum + (value - meanPortfolio) ** 2,
			0
		) / denominator;
	if (!(portfolioVariance > 0)) return { ...empty, observations };

	const rows: RiskContributionRow[] = series
		.map((entry, i) => {
			const returns = assetReturns[i];
			const meanAsset = mean(returns);
			let covariance = 0;
			for (let t = 0; t < observations; t += 1) {
				covariance +=
					(returns[t] - meanAsset) * (portfolioReturns[t] - meanPortfolio);
			}
			covariance /= denominator;
			return {
				symbol: entry.symbol,
				weightPct: round2(weights[i] * 100),
				sharePct: round2(((weights[i] * covariance) / portfolioVariance) * 100),
			};
		})
		.sort((a, b) => b.sharePct - a.sharePct);

	return {
		rows,
		observations,
		portfolioVolatility: round6(Math.sqrt(portfolioVariance * 252)),
		missingSymbols,
		excludedValuePct,
	};
}
