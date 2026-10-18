import type { RagIngestItem } from 'src/ai/rag-ingestion/application/rag-ingestion.port';
import type { Trade } from 'src/fiscal/domain/trade';

/**
 * Resumo mensal das operações por ativo (ADR-002, TRA-16). Cada nota de
 * corretagem ou extrato da B3 já vira `Trade` no Mongo; o que vai para o
 * índice é o resumo, nunca o arquivo enviado.
 *
 * Determinístico: o mesmo histórico gera o mesmo texto, então o
 * `content_hash` não muda e a ingestão diária não repete embedding. Operação
 * passada não muda, o que deixa os chunks estáveis.
 *
 * Perguntas de número exato ("quanto paguei de corretagem em 2025?") ficam
 * para a ferramenta `list_trades` (fase 2): busca vetorial acha "do que se
 * trata", não soma.
 */

/** Teto de histórico por ativo, para a primeira carga não crescer sem limite. */
export const TRADE_SUMMARY_MAX_MONTHS = 36;

interface SideTotals {
	count: number;
	quantity: number;
	notional: number;
}

interface MonthBucket {
	symbol: string;
	month: string; // YYYY-MM
	buy: SideTotals;
	sell: SideTotals;
	fees: number;
}

const emptySide = (): SideTotals => ({ count: 0, quantity: 0, notional: 0 });

const money = (value: number) =>
	value.toLocaleString('pt-BR', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

const quantity = (value: number) =>
	value.toLocaleString('pt-BR', { maximumFractionDigits: 4 });

const brMonth = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

function describeSide(label: [string, string], side: SideTotals): string {
	const noun = side.count === 1 ? label[0] : label[1];
	const averagePrice = side.quantity > 0 ? side.notional / side.quantity : 0;
	return `${side.count} ${noun} (${quantity(side.quantity)} unidades, preço médio R$ ${money(averagePrice)})`;
}

function monthKey(date: Date): string {
	return date.toISOString().slice(0, 7);
}

export function buildTradeSummaryItems(
	trades: Trade[],
	asOf: string
): RagIngestItem[] {
	const valid = trades.filter(
		(trade) =>
			trade.assetSymbol &&
			trade.date instanceof Date &&
			!Number.isNaN(trade.date.getTime()) &&
			trade.quantity > 0 &&
			Number.isFinite(trade.price)
	);
	if (!valid.length) return [];

	const buckets = new Map<string, MonthBucket>();
	for (const trade of valid) {
		const symbol = trade.assetSymbol.trim().toUpperCase();
		const month = monthKey(trade.date);
		const key = `${symbol}|${month}`;
		const bucket = buckets.get(key) ?? {
			symbol,
			month,
			buy: emptySide(),
			sell: emptySide(),
			fees: 0,
		};
		const side = trade.side === 'sell' ? bucket.sell : bucket.buy;
		side.count += 1;
		side.quantity += trade.quantity;
		side.notional += trade.quantity * trade.price;
		bucket.fees += trade.fees ?? 0;
		buckets.set(key, bucket);
	}

	const bySymbol = new Map<string, MonthBucket[]>();
	for (const bucket of buckets.values()) {
		const list = bySymbol.get(bucket.symbol) ?? [];
		list.push(bucket);
		bySymbol.set(bucket.symbol, list);
	}

	const items: RagIngestItem[] = [];
	for (const [symbol, list] of bySymbol) {
		// Só os meses mais recentes de cada ativo.
		const recent = list
			.sort((a, b) => b.month.localeCompare(a.month))
			.slice(0, TRADE_SUMMARY_MAX_MONTHS);
		for (const bucket of recent) {
			const parts: string[] = [];
			if (bucket.buy.count) {
				parts.push(describeSide(['compra', 'compras'], bucket.buy));
			}
			if (bucket.sell.count) {
				parts.push(describeSide(['venda', 'vendas'], bucket.sell));
			}
			const costs = bucket.fees > 0 ? `, custos R$ ${money(bucket.fees)}` : '';
			items.push({
				sourceType: 'portfolio_trade_summary',
				sourceId: `trade_summary:${symbol}:${bucket.month}`,
				content: `${symbol} em ${brMonth(bucket.month)}: ${parts.join(' e ')}${costs}.`,
				metadata: { symbol, month: bucket.month },
				asOf,
			});
		}
	}

	return items.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}
