import { brasiliaDate } from './trading-days';

const RANGE_DAYS: Record<string, number> = {
	'1d': 1,
	'5d': 5,
	'1mo': 31,
	'3mo': 93,
	'6mo': 186,
	'1y': 366,
	'2y': 731,
	'5y': 1827,
	'10y': 3653,
};

/** Folga entre o início pedido e o primeiro pregão guardado (fim de semana, feriado). */
const START_TOLERANCE_DAYS = 10;
/** Série cuja última cotação é mais velha que isso está parada. */
const FRESHNESS_DAYS = 10;

function shift(date: string, days: number): string {
	const moved = new Date(`${date}T00:00:00.000Z`);
	moved.setUTCDate(moved.getUTCDate() + days);
	return moved.toISOString().slice(0, 10);
}

/**
 * Data inicial do intervalo no vocabulário do Yahoo (`1y`, `5y`, `max`...).
 * `max` não tem início conhecido: devolve `'1900-01-01'`.
 */
export function rangeStart(range: string, now: Date): string {
	const key = String(range || '')
		.trim()
		.toLowerCase();
	const today = brasiliaDate(now);
	if (key === 'ytd') return `${today.slice(0, 4)}-01-01`;
	const days = RANGE_DAYS[key];
	return days === undefined ? '1900-01-01' : shift(today, -days);
}

/**
 * A série guardada responde ao pedido sem precisar do Yahoo: começa perto do
 * início do intervalo e não está parada. `max` nunca é provado completo (não
 * há início para comparar), então segue para o Yahoo e só cai na série
 * guardada se ele não responder.
 */
export function coversRange(
	closes: { date: string }[],
	range: string,
	now: Date
): boolean {
	if (!closes.length) return false;
	const key = String(range || '')
		.trim()
		.toLowerCase();
	if (key === 'max') return false;

	const start = rangeStart(range, now);
	const today = brasiliaDate(now);
	const first = closes[0].date;
	const last = closes[closes.length - 1].date;
	return (
		first <= shift(start, START_TOLERANCE_DAYS) &&
		last >= shift(today, -FRESHNESS_DAYS)
	);
}
