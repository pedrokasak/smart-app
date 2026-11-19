import type { TradeSide } from 'src/ai/orchestration/trade-history/trade-history.query';

/**
 * Resumo exato de um conjunto de operações (ADR-002, TRA-16, fase 2). Os
 * números saem desta soma, nunca do LLM: é por isso que "quanto paguei de
 * corretagem em 2025?" vira ferramenta e não busca vetorial.
 */
export interface TradeRow {
	symbol: string;
	side: TradeSide;
	quantity: number;
	price: number;
	fees?: number;
	date: Date;
}

export interface SideTotals {
	count: number;
	quantity: number;
	/** Quantidade × preço, sem custos. */
	total: number;
}

export interface TradeHistorySummary {
	count: number;
	buys: SideTotals;
	sells: SideTotals;
	/** Corretagem e emolumentos somados. */
	fees: number;
	firstDate: string | null;
	lastDate: string | null;
	/** Mais recentes primeiro, no máximo `MAX_TRADE_ITEMS`. */
	items: Array<{
		date: string;
		symbol: string;
		side: TradeSide;
		quantity: number;
		price: number;
	}>;
	truncated: boolean;
}

export const MAX_TRADE_ITEMS = 10;

const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
const day = (date: Date) => date.toISOString().slice(0, 10);
const emptySide = (): SideTotals => ({ count: 0, quantity: 0, total: 0 });

export function summarizeTrades(
	trades: readonly TradeRow[]
): TradeHistorySummary {
	const valid = trades.filter(
		(t) =>
			t.date instanceof Date &&
			!Number.isNaN(t.date.getTime()) &&
			t.quantity > 0 &&
			Number.isFinite(t.price)
	);
	const buys = emptySide();
	const sells = emptySide();
	let fees = 0;
	for (const trade of valid) {
		const side = trade.side === 'sell' ? sells : buys;
		side.count += 1;
		side.quantity += trade.quantity;
		side.total += trade.quantity * trade.price;
		fees += trade.fees ?? 0;
	}

	const ordered = [...valid].sort(
		(a, b) => b.date.getTime() - a.date.getTime()
	);
	const dates = ordered.map((t) => day(t.date));
	const finish = (side: SideTotals): SideTotals => ({
		count: side.count,
		quantity: round4(side.quantity),
		total: round2(side.total),
	});

	return {
		count: valid.length,
		buys: finish(buys),
		sells: finish(sells),
		fees: round2(fees),
		firstDate: dates.length ? dates[dates.length - 1] : null,
		lastDate: dates.length ? dates[0] : null,
		items: ordered.slice(0, MAX_TRADE_ITEMS).map((t) => ({
			date: day(t.date),
			symbol: t.symbol,
			side: t.side === 'sell' ? 'sell' : 'buy',
			quantity: round4(t.quantity),
			price: round2(t.price),
		})),
		truncated: ordered.length > MAX_TRADE_ITEMS,
	};
}
