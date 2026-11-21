import { InvalidCursorError } from 'src/advisor/application/ports/store-errors';
import type { Transaction } from 'src/advisor/domain/portfolio.entities';

type Position = [tradeDate: string, createdAt: string, id: string];

const compare = (a: Position, b: Position): number => {
	for (let i = 0; i < 3; i++) {
		if (a[i] < b[i]) return -1;
		if (a[i] > b[i]) return 1;
	}
	return 0;
};

const positionOf = (t: Transaction): Position => [
	t.tradeDate,
	t.createdAt.toISOString(),
	t.id,
];

const encode = (position: Position): string =>
	Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');

function decode(cursor: string): Position {
	try {
		const value: unknown = JSON.parse(
			Buffer.from(cursor, 'base64url').toString('utf8')
		);
		if (
			Array.isArray(value) &&
			value.length === 3 &&
			value.every((part) => typeof part === 'string')
		) {
			return value as Position;
		}
	} catch {
		// cai no erro abaixo
	}
	throw new InvalidCursorError();
}

/**
 * Página do livro. A ordem é (tradeDate, createdAt, id), reaplicada aqui: o
 * store desempata também por `seq`, que `Transaction` não expõe, então
 * empates exatos de data e criação (linhas de um mesmo import) seguem o id.
 * O cursor guarda a posição da última linha entregue e a página seguinte
 * começa na primeira linha estritamente depois dela; por isso apagar a
 * âncora (ou o lote inteiro) não quebra a paginação. Só cursor malformado
 * é recusado.
 */
export function pageLedger(
	ledger: Transaction[],
	query: { cursor?: string; limit: number }
): { items: Transaction[]; nextCursor: string | null } {
	const after = query.cursor === undefined ? null : decode(query.cursor);
	const ordered = ledger
		.map((t) => ({ t, position: positionOf(t) }))
		.sort((a, b) => compare(a.position, b.position));
	const remaining = after
		? ordered.filter((e) => compare(e.position, after) > 0)
		: ordered;
	const page = remaining.slice(0, query.limit);
	const hasMore = remaining.length > page.length;
	return {
		items: page.map((e) => e.t),
		nextCursor: hasMore ? encode(page[page.length - 1].position) : null,
	};
}
