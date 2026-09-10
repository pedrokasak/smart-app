import { nonTradingReason } from './trading-calendar';

/**
 * Reconstrói a série diária marcada a mercado a partir das negociações e de
 * preços históricos reais (TRA-143).
 *
 * ## Diferença para `history-from-trades.ts`
 *
 * Aquele módulo valoriza a posição pelo ÚLTIMO PREÇO NEGOCIADO, porque foi
 * escrito quando se acreditava que não havia cotação disponível. Entre duas
 * negociações a curva fica achatada: se o papel subiu 20% sem você negociar, o
 * gráfico não mostra. Ele é honesto sobre isso e se rotula "valor a preços
 * negociados".
 *
 * Aqui a posição é valorizada ao fechamento real de cada dia, quando existe.
 * A série resultante é comparável com índice e serve para beta e volatilidade —
 * o que a outra nunca pôde ser.
 *
 * ## O que NÃO faz
 *
 * Não inventa preço. Dia sem cotação para um símbolo mantém a última conhecida
 * e marca o ponto como `stale`, listando o símbolo. Um ponto marcado pode ser
 * descartado pelo consumidor; um ponto silenciosamente interpolado contamina
 * qualquer cálculo que o toque.
 *
 * Não reconstrói posição sem negociação. Carteira montada manualmente, sem nota
 * importada, não tem como saber quanto era a posição em datas passadas — o
 * resultado seria a posição de hoje projetada para trás, que é ficção. Esses
 * casos devolvem série vazia e `covered: false`.
 */

export interface BackfillTrade {
	symbol: string;
	side: 'buy' | 'sell';
	quantity: number;
	price: number;
	date: Date | string;
}

/** Fechamento por símbolo e dia: `prices.get('PETR4')?.get('2025-06-10')`. */
export type PriceLookup = Map<string, Map<string, number>>;

export interface BackfilledPoint {
	date: string;
	totalValue: number;
	investedValue: number;
	stale: boolean;
	staleSymbols: string[];
	tradingDay: boolean;
	nonTradingReason?: 'weekend' | 'holiday';
}

export interface BackfillResult {
	points: BackfilledPoint[];
	/** false quando não há negociação — reconstruir seria ficção. */
	covered: boolean;
}

const toIsoDay = (value: Date | string): string | null => {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const addDays = (iso: string, days: number): string => {
	const date = new Date(`${iso}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
};

const round = (value: number): number => Number(value.toFixed(2));

export function backfillSeries(params: {
	trades: BackfillTrade[];
	prices: PriceLookup;
	until?: Date | string;
}): BackfillResult {
	const normalized = (params.trades || [])
		.map((trade) => ({
			symbol: String(trade?.symbol || '').toUpperCase(),
			side: trade?.side,
			quantity: Number(trade?.quantity) || 0,
			price: Number(trade?.price) || 0,
			day: toIsoDay(trade?.date),
		}))
		.filter((t) => t.symbol && t.day && t.quantity > 0 && t.side);

	if (!normalized.length) {
		return { points: [], covered: false };
	}

	normalized.sort((a, b) => (a.day as string).localeCompare(b.day as string));

	const tradesByDay = new Map<string, typeof normalized>();
	for (const trade of normalized) {
		const list = tradesByDay.get(trade.day as string) ?? [];
		list.push(trade);
		tradesByDay.set(trade.day as string, list);
	}

	const lastDay = toIsoDay(params.until ?? new Date());
	if (!lastDay) return { points: [], covered: false };

	const quantityBySymbol = new Map<string, number>();
	const costBySymbol = new Map<string, number>();
	// Último fechamento conhecido, usado só quando o dia não tem cotação —
	// e sempre acompanhado da marcação `stale`.
	const lastKnownPrice = new Map<string, number>();

	const points: BackfilledPoint[] = [];

	for (
		let day = normalized[0].day as string;
		day <= lastDay;
		day = addDays(day, 1)
	) {
		for (const trade of tradesByDay.get(day) ?? []) {
			const currentQty = quantityBySymbol.get(trade.symbol) ?? 0;
			const currentCost = costBySymbol.get(trade.symbol) ?? 0;

			if (trade.side === 'buy') {
				quantityBySymbol.set(trade.symbol, currentQty + trade.quantity);
				costBySymbol.set(trade.symbol, currentCost + trade.quantity * trade.price);
			} else {
				// Venda reduz a posição pelo custo médio, não pelo preço de venda:
				// o custo que sai é o custo das cotas vendidas.
				const avg = currentQty > 0 ? currentCost / currentQty : 0;
				const sold = Math.min(trade.quantity, currentQty);
				const nextQty = Math.max(0, currentQty - trade.quantity);
				quantityBySymbol.set(trade.symbol, nextQty);
				costBySymbol.set(
					trade.symbol,
					nextQty <= 0 ? 0 : Math.max(0, currentCost - avg * sold)
				);
			}
		}

		let totalValue = 0;
		let investedValue = 0;
		const staleSymbols: string[] = [];

		for (const [symbol, quantity] of quantityBySymbol.entries()) {
			if (quantity <= 0) continue;

			investedValue += costBySymbol.get(symbol) ?? 0;

			const close = params.prices.get(symbol)?.get(day);
			if (typeof close === 'number' && Number.isFinite(close) && close > 0) {
				lastKnownPrice.set(symbol, close);
				totalValue += quantity * close;
				continue;
			}

			const carried = lastKnownPrice.get(symbol);
			if (typeof carried === 'number') {
				totalValue += quantity * carried;
			} else {
				// Nunca houve cotação: vale o custo médio pago.
				const avg = quantity > 0 ? (costBySymbol.get(symbol) ?? 0) / quantity : 0;
				totalValue += quantity * avg;
			}
			if (!staleSymbols.includes(symbol)) staleSymbols.push(symbol);
		}

		const reason = nonTradingReason(day);

		points.push({
			date: day,
			totalValue: round(totalValue),
			investedValue: round(investedValue),
			stale: staleSymbols.length > 0,
			staleSymbols,
			tradingDay: reason === null,
			...(reason ? { nonTradingReason: reason } : {}),
		});
	}

	return { points, covered: true };
}
