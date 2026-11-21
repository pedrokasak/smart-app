import { InvalidCursorError } from 'src/advisor/application/ports/store-errors';
import type { Transaction } from 'src/advisor/domain/portfolio.entities';

/**
 * Página do livro (já ordenado pelo store). O cursor é o id da última
 * transação entregue: se ela sumiu entre as chamadas (removida), o cursor
 * deixa de valer e o cliente recomeça pela primeira página.
 */
export function pageLedger(
	ledger: Transaction[],
	query: { cursor?: string; limit: number }
): { items: Transaction[]; nextCursor: string | null } {
	let start = 0;
	if (query.cursor !== undefined) {
		const index = ledger.findIndex((t) => t.id === query.cursor);
		if (index === -1) throw new InvalidCursorError();
		start = index + 1;
	}
	const items = ledger.slice(start, start + query.limit);
	const hasMore = start + items.length < ledger.length;
	return {
		items,
		nextCursor: hasMore ? items[items.length - 1].id : null,
	};
}
