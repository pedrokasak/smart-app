import { Alert } from '../domain/attention.entities';
import { alertPriorityRank } from '../domain/alert-priority';
import { InvalidCursorError } from './ports/store-errors';

/** Alerta sem prazo ordena depois de qualquer data. */
export const NO_DUE_SENTINEL = '9999-12-31';

/** Tupla de ordenação da fila: rank, prazo, `createdAt` (decrescente), id. */
export interface AlertCursor {
	rank: number;
	due: string;
	createdAt: Date;
	id: string;
}

export const alertCursorOf = (alert: Alert): AlertCursor => ({
	rank: alertPriorityRank(alert.priority),
	due: alert.dueDate ?? NO_DUE_SENTINEL,
	createdAt: alert.createdAt,
	id: alert.id,
});

/** Negativo quando `a` vem antes de `b` na fila. */
export function compareAlertCursor(a: AlertCursor, b: AlertCursor): number {
	if (a.rank !== b.rank) return a.rank - b.rank;
	if (a.due !== b.due) return a.due < b.due ? -1 : 1;
	const at = a.createdAt.getTime();
	const bt = b.createdAt.getTime();
	if (at !== bt) return bt - at;
	if (a.id === b.id) return 0;
	return a.id < b.id ? -1 : 1;
}

/** Cursor opaco: base64url da tupla de ordenação do último item da página. */
export function encodeAlertCursor(cursor: AlertCursor): string {
	return Buffer.from(
		JSON.stringify({
			r: cursor.rank,
			d: cursor.due,
			c: cursor.createdAt.toISOString(),
			i: cursor.id,
		})
	).toString('base64url');
}

export function decodeAlertCursor(raw: string): AlertCursor {
	try {
		const parsed = JSON.parse(
			Buffer.from(raw, 'base64url').toString('utf8')
		) as { r?: unknown; d?: unknown; c?: unknown; i?: unknown };
		const { r, d, c, i } = parsed;
		if (
			typeof r !== 'number' ||
			!Number.isInteger(r) ||
			r < 0 ||
			r > 3 ||
			typeof d !== 'string' ||
			typeof c !== 'string' ||
			typeof i !== 'string'
		) {
			throw new InvalidCursorError();
		}
		const createdAt = new Date(c);
		if (Number.isNaN(createdAt.getTime())) throw new InvalidCursorError();
		return { rank: r, due: d, createdAt, id: i };
	} catch {
		throw new InvalidCursorError();
	}
}

export const ALERT_PAGE_MAX = 500;

/** Tamanho de página entre 1 e 500. */
export const clampAlertPageSize = (limit: number): number =>
	Math.min(Math.max(Math.trunc(limit) || 1, 1), ALERT_PAGE_MAX);
