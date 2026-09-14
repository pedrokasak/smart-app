/**
 * Proventos RECEBIDOS por ativo e mês.
 *
 * `Asset.dividendHistory.value` é o provento POR COTA (mesma leitura de
 * `dividendsPerShareInWindow`). O valor recebido é esse número vezes a
 * quantidade que a pessoa tinha na data do evento, reconstruída pelas
 * negociações. Sem negociação do ativo, usa a quantidade atual e marca a
 * linha como estimada.
 */
export interface DividendAssetInput {
	symbol: string;
	quantity: number;
	dividendHistory?: {
		date?: Date | string;
		value?: number;
		paymentType?: string;
	}[];
}

export interface DividendTradeInput {
	symbol: string;
	side: 'buy' | 'sell';
	quantity: number;
	date: Date | string;
}

export interface ReceivedDividendRow {
	symbol: string;
	month: number;
	paymentType: string;
	perShare: number;
	quantity: number;
	amount: number;
	estimated: boolean;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function quantityAt(trades: DividendTradeInput[], date: Date): number | null {
	if (trades.length === 0) return null;
	let quantity = 0;
	for (const trade of trades) {
		if (new Date(trade.date).getTime() > date.getTime()) break;
		quantity += trade.side === 'buy' ? trade.quantity : -trade.quantity;
	}
	return Math.max(quantity, 0);
}

export function computeReceivedDividends(
	assets: DividendAssetInput[],
	trades: DividendTradeInput[],
	year: number
): ReceivedDividendRow[] {
	const tradesBySymbol = new Map<string, DividendTradeInput[]>();
	for (const trade of trades) {
		const symbol = String(trade.symbol || '').toUpperCase();
		const list = tradesBySymbol.get(symbol) ?? [];
		list.push(trade);
		tradesBySymbol.set(symbol, list);
	}
	for (const list of tradesBySymbol.values()) {
		list.sort(
			(a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
		);
	}

	const rows: ReceivedDividendRow[] = [];
	const seen = new Set<string>();
	for (const asset of assets) {
		const symbol = String(asset.symbol || '').toUpperCase();
		for (const event of asset.dividendHistory ?? []) {
			const date = event?.date ? new Date(event.date) : null;
			const perShare = Number(event?.value) || 0;
			if (!date || Number.isNaN(date.getTime())) continue;
			if (date.getUTCFullYear() !== year || perShare <= 0) continue;

			// O mesmo ativo pode existir em mais de uma carteira com o mesmo histórico.
			const key = `${symbol}|${date.toISOString()}|${event.paymentType ?? ''}`;
			if (seen.has(key)) continue;
			seen.add(key);

			const fromTrades = quantityAt(tradesBySymbol.get(symbol) ?? [], date);
			const quantity = fromTrades ?? (Number(asset.quantity) || 0);
			if (quantity <= 0) continue;

			rows.push({
				symbol,
				month: date.getUTCMonth() + 1,
				paymentType: event.paymentType ?? 'DIVIDEND',
				perShare,
				quantity,
				amount: round2(perShare * quantity),
				estimated: fromTrades === null,
			});
		}
	}

	return rows.sort(
		(a, b) => a.month - b.month || a.symbol.localeCompare(b.symbol)
	);
}
