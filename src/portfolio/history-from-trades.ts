/**
 * Reconstrói o histórico da carteira a partir das negociações.
 *
 * O snapshot diário só grava `quantidade × preço`, e o preço fica parado
 * enquanto as fontes de cotação não estão ligadas — então todos os dias
 * gravam o mesmo número e a curva sai reta. Não é defeito de cálculo, é
 * ausência de cotação.
 *
 * Mas quem importou o extrato de negociação tem dado suficiente para uma
 * curva de verdade: cada compra e venda traz data, quantidade e preço
 * efetivamente praticado. Dá para saber a posição em qualquer data
 * passada e valorizá-la ao último preço observado até ali.
 *
 * O que isto NÃO é: marcação a mercado. Entre duas negociações o preço
 * usado é o da última — se o papel subiu 20% sem você negociar, a curva
 * não mostra. Por isso a série é rotulada como valor a preços negociados,
 * e não substitui a cotação real; ela existe para o gráfico refletir o
 * que de fato aconteceu na carteira (aportes, vendas, custo) em vez de
 * uma linha reta ou, pior, de um valor constante inventado.
 */

export interface HistoryTrade {
	symbol: string;
	side: 'buy' | 'sell';
	quantity: number;
	price: number;
	date: Date | string;
}

export interface DerivedHistoryPoint {
	date: string;
	totalValue: number;
	/** Quanto saiu do bolso, líquido de vendas, até a data. */
	investedValue: number;
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

/**
 * Um ponto por dia entre a primeira negociação e `until` (padrão: hoje).
 * Dias sem negociação repetem a posição do dia anterior — isso não é
 * invenção, é o fato de nada ter mudado naquele dia.
 */
export function buildHistoryFromTrades(
	trades: HistoryTrade[],
	until: Date = new Date()
): DerivedHistoryPoint[] {
	const normalized = trades
		.map((trade) => ({
			symbol: String(trade.symbol || '').toUpperCase(),
			side: trade.side,
			quantity: Number(trade.quantity) || 0,
			price: Number(trade.price) || 0,
			day: toIsoDay(trade.date),
		}))
		.filter(
			(trade) => trade.symbol && trade.day && trade.quantity > 0
		) as Array<{
		symbol: string;
		side: 'buy' | 'sell';
		quantity: number;
		price: number;
		day: string;
	}>;

	if (!normalized.length) return [];

	normalized.sort((a, b) => a.day.localeCompare(b.day));

	const tradesByDay = new Map<string, typeof normalized>();
	for (const trade of normalized) {
		const list = tradesByDay.get(trade.day) ?? [];
		list.push(trade);
		tradesByDay.set(trade.day, list);
	}

	const lastDay = toIsoDay(until);
	if (!lastDay) return [];

	const quantityBySymbol = new Map<string, number>();
	const lastPriceBySymbol = new Map<string, number>();
	let invested = 0;

	const points: DerivedHistoryPoint[] = [];

	for (let day = normalized[0].day; day <= lastDay; day = addDays(day, 1)) {
		for (const trade of tradesByDay.get(day) ?? []) {
			const current = quantityBySymbol.get(trade.symbol) ?? 0;
			const signed = trade.side === 'buy' ? trade.quantity : -trade.quantity;

			// Não deixa a posição ficar negativa: uma venda sem compra
			// correspondente no arquivo importado é histórico incompleto, não
			// posição vendida.
			const next = Math.max(0, current + signed);
			quantityBySymbol.set(trade.symbol, next);

			if (trade.price > 0) {
				lastPriceBySymbol.set(trade.symbol, trade.price);
			}

			const movimento = trade.quantity * trade.price;
			invested += trade.side === 'buy' ? movimento : -movimento;
		}

		let totalValue = 0;
		for (const [symbol, quantity] of quantityBySymbol.entries()) {
			if (quantity <= 0) continue;
			totalValue += quantity * (lastPriceBySymbol.get(symbol) ?? 0);
		}

		points.push({
			date: day,
			totalValue: Number(totalValue.toFixed(2)),
			investedValue: Number(Math.max(0, invested).toFixed(2)),
		});
	}

	return points;
}
