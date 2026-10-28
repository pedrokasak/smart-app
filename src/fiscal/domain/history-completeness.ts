/**
 * Ativos cujo histórico de negociações não fecha (TRA-97).
 *
 * O relatório de IR calcula posição e custo a partir das compras e vendas
 * importadas. Se uma venda é maior que a posição que o histórico conhece, falta
 * algo: uma compra que não foi importada (outra corretora, transferência), ou
 * um desdobramento/bonificação que nenhum dado do sistema registra. O cálculo
 * zera a posição e segue, em silêncio, e o custo e a quantidade em 31/12 saem
 * errados. Aqui o problema vira um aviso por ativo.
 */
export interface CompletenessTrade {
	symbol?: string | null;
	side?: string | null;
	quantity?: number | null;
	date?: Date | string | null;
}

export interface IncompleteHistoryItem {
	symbol: string;
	/** Quanto foi vendido além do que o histórico mostra. */
	missingQuantity: number;
	/** Primeira venda sem posição suficiente, AAAA-MM-DD. */
	firstShortfallDate: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Cripto tem quantidade fracionária: ruído de ponto flutuante não é falta.
const EPSILON = 1e-8;

const dayOf = (date: Date) => Math.floor(date.getTime() / DAY_MS);

export function findIncompleteHistory(
	trades: CompletenessTrade[]
): IncompleteHistoryItem[] {
	const valid = (trades || [])
		.map((trade) => ({
			symbol: String(trade?.symbol || '').toUpperCase(),
			isSell: String(trade?.side || '').toLowerCase() === 'sell',
			quantity: Number(trade?.quantity),
			date: trade?.date ? new Date(trade.date) : null,
		}))
		.filter(
			(trade) =>
				trade.symbol &&
				trade.date &&
				!Number.isNaN(trade.date.getTime()) &&
				Number.isFinite(trade.quantity) &&
				trade.quantity > 0
		) as Array<{
		symbol: string;
		isSell: boolean;
		quantity: number;
		date: Date;
	}>;

	// No mesmo dia a compra vale antes da venda: day trade não pode parecer
	// venda sem posição só porque a ordem do banco trouxe a venda primeiro.
	valid.sort((a, b) =>
		dayOf(a.date) !== dayOf(b.date)
			? dayOf(a.date) - dayOf(b.date)
			: Number(a.isSell) - Number(b.isSell)
	);

	const held = new Map<string, number>();
	const found = new Map<string, IncompleteHistoryItem>();

	for (const trade of valid) {
		const current = held.get(trade.symbol) ?? 0;
		if (!trade.isSell) {
			held.set(trade.symbol, current + trade.quantity);
			continue;
		}
		const shortfall = trade.quantity - current;
		if (shortfall > EPSILON) {
			const item = found.get(trade.symbol) ?? {
				symbol: trade.symbol,
				missingQuantity: 0,
				firstShortfallDate: trade.date.toISOString().slice(0, 10),
			};
			item.missingQuantity += shortfall;
			found.set(trade.symbol, item);
		}
		held.set(trade.symbol, Math.max(current - trade.quantity, 0));
	}

	return Array.from(found.values())
		.map((item) => ({
			...item,
			missingQuantity: Math.round(item.missingQuantity * 1e8) / 1e8,
		}))
		.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
