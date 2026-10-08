const BRASILIA = 'America/Sao_Paulo';

/** YYYY-MM-DD no calendário de Brasília (o pregão é de lá). */
export function brasiliaDate(now: Date): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: BRASILIA,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(now);
}

function shift(date: string, days: number): string {
	const moved = new Date(`${date}T00:00:00.000Z`);
	moved.setUTCDate(moved.getUTCDate() + days);
	return moved.toISOString().slice(0, 10);
}

export function isWeekday(date: string): boolean {
	const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
	return day !== 0 && day !== 6;
}

/**
 * Os últimos `count` dias úteis (seg-sex) até hoje, do mais antigo ao mais
 * novo. Feriado de semana não é filtrado: a B3 simplesmente não publica o
 * arquivo e a ingestão trata isso como "sem pregão".
 */
export function lastWeekdays(now: Date, count: number): string[] {
	const days: string[] = [];
	let cursor = brasiliaDate(now);
	while (days.length < count) {
		if (isWeekday(cursor)) days.unshift(cursor);
		cursor = shift(cursor, -1);
	}
	return days;
}

export function daysAgo(now: Date, days: number): string {
	return shift(brasiliaDate(now), -days);
}

export function yearOf(date: string): number {
	return Number(date.slice(0, 4));
}
