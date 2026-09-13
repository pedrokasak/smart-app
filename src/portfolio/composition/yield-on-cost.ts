/**
 * Yield on cost: quanto a posição rende sobre o que foi PAGO por ela (TRA-141).
 *
 * ## Por que não é o mesmo que dividend yield
 *
 * O yield de mercado divide o provento pelo preço de hoje. Ele responde "vale a
 * pena comprar agora?" e muda toda vez que a cotação mexe — quem comprou há
 * cinco anos vê o mesmo número de quem comprou ontem.
 *
 * O yield on cost divide pelo custo médio de aquisição. Responde "quanto o
 * dinheiro que EU coloquei está rendendo", e é o número que mostra o efeito de
 * ter comprado barato: uma posição que rende 4% ao preço atual pode render 12%
 * sobre o custo de quem entrou cedo.
 *
 * Os dois juntos contam a história inteira. Só um deles, nenhuma.
 *
 * ## Definição escolhida
 *
 * Por AÇÃO: `dividendos por ação nos últimos 12 meses / custo médio por ação`.
 *
 * Deliberadamente independente de quantidade. A alternativa — somar o que foi
 * efetivamente recebido — exigiria saber quantas cotas o usuário tinha em cada
 * data de pagamento, o que só é reconstituível com histórico de negociação
 * completo. Quem montou a posição manualmente não teria número nenhum.
 *
 * No agregado da carteira a quantidade entra, ponderando pelo custo de cada
 * posição. Aí a premissa é que a quantidade ATUAL valeu para os 12 meses — o
 * que é falso para quem aumentou posição no meio do período. Por isso o
 * agregado vem com `approximated: true` quando alguma posição é mais nova que a
 * janela; a interface decide se mostra ou se explica.
 */

export interface YieldOnCostAsset {
	symbol?: string;
	quantity?: number | null;
	/** Preço de entrada — custo médio por ação. */
	price?: number | null;
	currentPrice?: number | null;
	dividendHistory?: { date?: Date | string; value?: number }[] | null;
	/** Data de criação da posição, para detectar histórico mais curto que a janela. */
	createdAt?: Date | string | null;
}

export interface AssetYield {
	symbol: string;
	/** Proventos por ação nos últimos 12 meses. */
	dividendsPerShare: number;
	/** Rendimento sobre o custo médio, em fração. `null` sem custo. */
	yieldOnCost: number | null;
	/** Rendimento sobre a cotação atual, em fração. `null` sem cotação. */
	yieldOnMarket: number | null;
}

export interface YieldOnCostResult {
	assets: AssetYield[];
	/** Yield on cost da carteira, ponderado pelo custo das posições. */
	portfolioYieldOnCost: number | null;
	portfolioYieldOnMarket: number | null;
	/** Proventos totais estimados em 12 meses, pela quantidade atual. */
	estimatedAnnualIncome: number;
	/**
	 * true quando alguma posição é mais nova que a janela de 12 meses — o
	 * agregado assume quantidade constante e superestima nesses casos.
	 */
	approximated: boolean;
}

const WINDOW_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const round6 = (value: number): number => Number(value.toFixed(6));
const round2 = (value: number): number => Number(value.toFixed(2));

const toTime = (value?: Date | string | null): number | null => {
	if (!value) return null;
	const parsed = new Date(value).getTime();
	return Number.isFinite(parsed) ? parsed : null;
};

/** Soma os proventos por ação dentro da janela, ignorando data inválida. */
export function dividendsPerShareInWindow(
	history: YieldOnCostAsset['dividendHistory'],
	now: number
): number {
	const cutoff = now - WINDOW_DAYS * MS_PER_DAY;
	let total = 0;

	for (const payout of history || []) {
		const time = toTime(payout?.date);
		if (time === null || time < cutoff || time > now) continue;
		const value = Number(payout?.value);
		if (!Number.isFinite(value) || value <= 0) continue;
		total += value;
	}

	return total;
}

export function computeYieldOnCost(
	assets: YieldOnCostAsset[],
	now: number = Date.now()
): YieldOnCostResult {
	const cutoff = now - WINDOW_DAYS * MS_PER_DAY;

	const rows: AssetYield[] = [];
	let weightedCost = 0;
	let weightedMarket = 0;
	let annualIncome = 0;
	let approximated = false;

	for (const asset of assets || []) {
		const quantity = Number(asset?.quantity) || 0;
		if (quantity <= 0) continue;

		const cost = Number(asset?.price) || 0;
		const market = Number(asset?.currentPrice) || 0;
		const dividendsPerShare = dividendsPerShareInWindow(
			asset?.dividendHistory,
			now
		);

		rows.push({
			symbol: String(asset?.symbol || '').toUpperCase(),
			dividendsPerShare: round6(dividendsPerShare),
			yieldOnCost: cost > 0 ? round6(dividendsPerShare / cost) : null,
			yieldOnMarket: market > 0 ? round6(dividendsPerShare / market) : null,
		});

		const created = toTime(asset?.createdAt);
		if (created !== null && created > cutoff) approximated = true;

		annualIncome += dividendsPerShare * quantity;
		weightedCost += cost * quantity;
		weightedMarket += market * quantity;
	}

	return {
		assets: rows,
		portfolioYieldOnCost:
			weightedCost > 0 ? round6(annualIncome / weightedCost) : null,
		portfolioYieldOnMarket:
			weightedMarket > 0 ? round6(annualIncome / weightedMarket) : null,
		estimatedAnnualIncome: round2(annualIncome),
		approximated,
	};
}
