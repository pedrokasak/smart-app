/**
 * Fluxos de caixa externos da carteira (TRA-143).
 *
 * ## Por que custo não serve
 *
 * `investedValue` é custo de aquisição do que ainda está em carteira. Ele cai
 * quando o usuário vende — mas cai pelo CUSTO das cotas vendidas, não pelo
 * dinheiro que entrou no bolso. Quem vende com lucro vê o custo diminuir menos
 * do que o caixa aumentou.
 *
 * Para retorno time-weighted o que importa é o fluxo externo: quanto dinheiro
 * entrou ou saiu da carteira em cada dia, independente de lucro. Sem separar
 * isso, aportar dinheiro parece rendimento e o retorno reportado é uma mentira
 * proporcional ao tamanho do aporte.
 *
 * ## Fórmula
 *
 * Compra é fluxo positivo (dinheiro entrando na carteira) de
 * `quantidade × preço + taxas`. Venda é fluxo negativo de
 * `quantidade × preço − taxas` — as taxas reduzem o que efetivamente saiu.
 *
 * ## Limite honesto
 *
 * Só é correto para carteiras cujo histórico de negociação está completo. Ativo
 * adicionado manualmente, sem nota importada, não produz fluxo: a série sabe
 * que a posição existe mas não quando o dinheiro entrou. Por isso
 * `computeDailyCashFlows` reporta `covered`, e quem consome decide se o TWR é
 * calculável ou se o número seria confiante e errado (precedente TRA-55).
 */

export interface CashFlowTrade {
	side: 'buy' | 'sell';
	quantity: number;
	price: number;
	fees?: number;
	date: Date | string;
}

export interface DailyCashFlow {
	/** YYYY-MM-DD */
	date: string;
	/** Fluxo líquido do dia. Positivo = aporte, negativo = retirada. */
	flow: number;
}

export interface CashFlowSeries {
	byDay: DailyCashFlow[];
	/** Soma de todos os fluxos até o fim da série. */
	netContribution: number;
	/** false quando não há negociação alguma — TWR não é calculável. */
	covered: boolean;
}

const toIsoDay = (value: Date | string): string | null => {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const toNumber = (value: unknown): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

/** Fluxo de um único negócio. Compra entra positivo, venda sai negativo. */
export function tradeCashFlow(trade: CashFlowTrade): number {
	const quantity = toNumber(trade?.quantity);
	const price = toNumber(trade?.price);
	const fees = toNumber(trade?.fees);
	if (quantity <= 0) return 0;

	const gross = quantity * price;
	return trade.side === 'buy' ? gross + fees : -(gross - fees);
}

export function computeDailyCashFlows(trades: CashFlowTrade[]): CashFlowSeries {
	const byDayMap = new Map<string, number>();
	let netContribution = 0;
	let counted = 0;

	for (const trade of trades || []) {
		const day = toIsoDay(trade?.date);
		if (!day) continue;

		const flow = tradeCashFlow(trade);
		if (flow === 0) continue;

		byDayMap.set(day, (byDayMap.get(day) || 0) + flow);
		netContribution += flow;
		counted += 1;
	}

	const byDay = Array.from(byDayMap.entries())
		.map(([date, flow]) => ({ date, flow: Number(flow.toFixed(2)) }))
		.sort((a, b) => a.date.localeCompare(b.date));

	return {
		byDay,
		netContribution: Number(netContribution.toFixed(2)),
		covered: counted > 0,
	};
}

/** Fluxo acumulado até `isoDay`, inclusive. */
export function netContributionUntil(
	series: CashFlowSeries,
	isoDay: string
): number {
	let total = 0;
	for (const point of series.byDay) {
		if (point.date > isoDay) break;
		total += point.flow;
	}
	return Number(total.toFixed(2));
}
