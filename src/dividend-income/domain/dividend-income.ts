/**
 * Como a renda de proventos pode crescer (docs/requisitos/ia-didatica.md,
 * RF-8). Só usa o que a carteira já tem: histórico de proventos por ativo,
 * quantidade, preço médio e preço atual, e o plano financeiro da pessoa.
 * Nada aqui escolhe ativo: o resultado são fatos e consequências.
 */

const WINDOW_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS_PER_YEAR = 12;
/** Teto da busca do prazo da meta: 100 anos. */
const MAX_GOAL_MONTHS = 1200;
export const PROJECTION_YEARS = [5, 10] as const;

/** Yield alto com preço caído: o número sobe porque o preço desceu. */
const TRAP_MIN_YIELD = 0.08;
const TRAP_MAX_PRICE_CHANGE = -0.2;
/** Um pagamento com metade ou mais do ano, entre vários, é extraordinário. */
const EXTRAORDINARY_SHARE = 0.5;
const EXTRAORDINARY_MIN_PAYOUTS = 3;
/**
 * Um pagamento grande que já apareceu no ano anterior (60% do tamanho ou
 * mais) é o dividendo anual recorrente, não um extraordinário: o padrão de
 * JCP trimestral mais dividendo anual não deve ser marcado.
 */
const RECURRING_PRIOR_SHARE = 0.6;
/** A partir daqui, a renda depende demais de um pagador. */
export const CONCENTRATED_PAYER_SHARE_PCT = 40;

export interface DividendAsset {
	symbol?: string | null;
	quantity?: number | null;
	/** Preço médio de compra. */
	price?: number | null;
	currentPrice?: number | null;
	dividendHistory?: Array<{
		date?: Date | string | null;
		value?: number | null;
	}> | null;
	createdAt?: Date | string | null;
}

export interface IncomeGoalPlan {
	/** Retorno real anual esperado do plano, em %, já com os proventos. */
	expectedRealReturnPct: number;
	monthlyContribution: number;
	goal: { title: string; targetAmount: number } | null;
	/**
	 * Patrimônio de todas as carteiras, base da meta de independência. Sem ele,
	 * vale o valor das posições analisadas.
	 */
	patrimony?: number;
}

export interface DividendPayer {
	symbol: string;
	amount: number;
	sharePct: number;
}

export interface DividendTrap {
	symbol: string;
	kind: 'price_drop' | 'extraordinary';
	yieldOnMarketPct: number;
	/** Variação do preço atual contra o preço médio, em %. */
	priceChangePct: number | null;
	/** Peso do maior pagamento no total do ativo em 12 meses, em %. */
	largestPayoutSharePct: number | null;
}

export interface DividendIncomeFacts {
	total12m: number;
	monthlyAvg: number;
	portfolioValue: number;
	yieldOnMarketPct: number | null;
	yieldOnCostPct: number | null;
	/** Alguma posição é mais nova que 12 meses: o total está superestimado. */
	approximated: boolean;
	payers: DividendPayer[];
	/** Renda mensal reinvestindo os proventos, em reais de hoje. */
	projection: Array<{ years: number; monthlyIncome: number }>;
	/** A projeção deixou de fora pagamentos extraordinários. */
	projectionExcludesOneOff: boolean;
	traps: DividendTrap[];
	goal: {
		title: string;
		targetAmount: number;
		/** `null` quando a meta não é alcançada em 100 anos. */
		monthsReinvesting: number | null;
		monthsSpending: number | null;
	} | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

const toTime = (value?: Date | string | null): number | null => {
	if (!value) return null;
	const time = new Date(value).getTime();
	return Number.isFinite(time) ? time : null;
};

interface SymbolTotals {
	symbol: string;
	quantity: number;
	cost: number;
	market: number;
	amount: number;
	payouts: number[];
	previousPayouts: number[];
}

/** Meses até `target` com aporte mensal e taxa anual real; `null` se não chega. */
export function monthsToTarget(
	start: number,
	monthlyContribution: number,
	annualPct: number,
	target: number
): number | null {
	if (start >= target) return 0;
	const monthly = (1 + annualPct / 100) ** (1 / MONTHS_PER_YEAR) - 1;
	let value = start;
	for (let month = 1; month <= MAX_GOAL_MONTHS; month++) {
		value = value * (1 + monthly) + monthlyContribution;
		if (value >= target) return month;
	}
	return null;
}

export function analyzeDividendIncome(
	assets: DividendAsset[],
	plan: IncomeGoalPlan | null,
	now: number = Date.now()
): DividendIncomeFacts {
	const cutoff = now - WINDOW_DAYS * DAY_MS;
	const bySymbol = new Map<string, SymbolTotals>();
	let approximated = false;

	for (const asset of assets || []) {
		const quantity = Number(asset?.quantity) || 0;
		const symbol = String(asset?.symbol || '').toUpperCase();
		if (quantity <= 0 || !symbol) continue;

		const payouts: number[] = [];
		const previousPayouts: number[] = [];
		const previousCutoff = cutoff - WINDOW_DAYS * DAY_MS;
		for (const payout of asset?.dividendHistory || []) {
			const time = toTime(payout?.date);
			const value = Number(payout?.value);
			if (time === null || time < previousCutoff || time > now) continue;
			if (!Number.isFinite(value) || value <= 0) continue;
			(time >= cutoff ? payouts : previousPayouts).push(value);
		}
		const created = toTime(asset?.createdAt);
		if (payouts.length && created !== null && created > cutoff) {
			approximated = true;
		}

		const perShare = payouts.reduce((sum, value) => sum + value, 0);
		const totals = bySymbol.get(symbol) ?? {
			symbol,
			quantity: 0,
			cost: 0,
			market: 0,
			amount: 0,
			// O histórico é do ativo, igual em toda carteira que o tem.
			payouts,
			previousPayouts,
		};
		totals.quantity += quantity;
		totals.cost += (Number(asset?.price) || 0) * quantity;
		totals.market +=
			(Number(asset?.currentPrice) || Number(asset?.price) || 0) * quantity;
		totals.amount += perShare * quantity;
		bySymbol.set(symbol, totals);
	}

	const rows = [...bySymbol.values()];
	const total12m = rows.reduce((sum, row) => sum + row.amount, 0);
	const portfolioValue = rows.reduce((sum, row) => sum + row.market, 0);
	const portfolioCost = rows.reduce((sum, row) => sum + row.cost, 0);
	const yieldOnMarket = portfolioValue > 0 ? total12m / portfolioValue : null;
	const yieldOnCost = portfolioCost > 0 ? total12m / portfolioCost : null;

	const payers = rows
		.filter((row) => row.amount > 0)
		.sort((a, b) => b.amount - a.amount)
		.slice(0, 3)
		.map((row) => ({
			symbol: row.symbol,
			amount: round2(row.amount),
			sharePct: round2((row.amount / total12m) * 100),
		}));

	const traps: DividendTrap[] = [];
	let oneOffAmount = 0;
	for (const row of rows) {
		if (!(row.amount > 0) || !(row.market > 0)) continue;
		const yieldPct = (row.amount / row.market) * 100;
		const priceChange = row.cost > 0 ? row.market / row.cost - 1 : null;
		const perShare = row.payouts.reduce((sum, value) => sum + value, 0);
		const largest = row.payouts.length ? Math.max(...row.payouts) : 0;
		const largestShare = perShare > 0 ? largest / perShare : null;
		// Sem histórico do ano anterior não dá para separar o recorrente.
		const recurredLastYear =
			!row.previousPayouts.length ||
			Math.max(...row.previousPayouts) >= RECURRING_PRIOR_SHARE * largest;

		if (
			yieldPct / 100 >= TRAP_MIN_YIELD &&
			priceChange !== null &&
			priceChange <= TRAP_MAX_PRICE_CHANGE
		) {
			traps.push({
				symbol: row.symbol,
				kind: 'price_drop',
				yieldOnMarketPct: round2(yieldPct),
				priceChangePct: round2(priceChange * 100),
				largestPayoutSharePct: null,
			});
		} else if (
			largestShare !== null &&
			row.payouts.length >= EXTRAORDINARY_MIN_PAYOUTS &&
			largestShare >= EXTRAORDINARY_SHARE &&
			!recurredLastYear
		) {
			oneOffAmount += largest * row.quantity;
			traps.push({
				symbol: row.symbol,
				kind: 'extraordinary',
				yieldOnMarketPct: round2(yieldPct),
				priceChangePct: null,
				largestPayoutSharePct: round2(largestShare * 100),
			});
		}
	}

	// Reinvestir a um yield constante faz a renda crescer a esse yield. Em
	// reais de hoje, supondo proventos que acompanham a inflação. O
	// extraordinário sai da base: não se repete para ser reinvestido.
	const monthlyAvg = total12m / MONTHS_PER_YEAR;
	const recurring = total12m - oneOffAmount;
	const recurringYield = portfolioValue > 0 ? recurring / portfolioValue : null;
	const projection =
		recurringYield !== null && recurring > 0
			? PROJECTION_YEARS.map((years) => ({
					years,
					monthlyIncome: round2(
						(recurring / MONTHS_PER_YEAR) * (1 + recurringYield) ** years
					),
				}))
			: [];

	// O retorno do plano já inclui os proventos reinvestidos. Gastá-los tira
	// o yield do crescimento: (1 + r) / (1 + yield) − 1.
	let goal: DividendIncomeFacts['goal'] = null;
	if (plan?.goal && plan.goal.targetAmount > 0 && yieldOnMarket !== null) {
		const spendingPct =
			((1 + plan.expectedRealReturnPct / 100) / (1 + yieldOnMarket) - 1) * 100;
		const patrimony = plan.patrimony ?? portfolioValue;
		goal = {
			title: plan.goal.title,
			targetAmount: plan.goal.targetAmount,
			monthsReinvesting: monthsToTarget(
				patrimony,
				plan.monthlyContribution,
				plan.expectedRealReturnPct,
				plan.goal.targetAmount
			),
			monthsSpending: monthsToTarget(
				patrimony,
				plan.monthlyContribution,
				spendingPct,
				plan.goal.targetAmount
			),
		};
	}

	return {
		total12m: round2(total12m),
		monthlyAvg: round2(monthlyAvg),
		portfolioValue: round2(portfolioValue),
		yieldOnMarketPct:
			yieldOnMarket === null ? null : round2(yieldOnMarket * 100),
		yieldOnCostPct: yieldOnCost === null ? null : round2(yieldOnCost * 100),
		approximated,
		payers,
		projection,
		projectionExcludesOneOff: oneOffAmount > 0,
		traps,
		goal,
	};
}
