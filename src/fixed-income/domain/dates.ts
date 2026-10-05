const DAY_MS = 24 * 60 * 60 * 1000;

const utcTime = (isoDate: string) =>
	new Date(`${isoDate}T00:00:00.000Z`).getTime();

/** Soma dias corridos a uma data YYYY-MM-DD, sem depender de fuso. */
export function addDays(isoDate: string, days: number): string {
	return new Date(utcTime(isoDate) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Dias corridos de `fromIso` até `toIso` (negativo se `toIso` for anterior). */
export function daysBetween(fromIso: string, toIso: string): number {
	return Math.round((utcTime(toIso) - utcTime(fromIso)) / DAY_MS);
}

/** YYYY-MM-DD → DD/MM/AAAA, para texto exibido a quem usa o app. */
export function toBrDate(isoDate: string): string {
	return isoDate.split('-').reverse().join('/');
}

/** YYYY-MM-DD → MM/AAAA, para série mensal (o dia não quer dizer nada). */
export function toBrMonth(isoDate: string): string {
	const [year, month] = isoDate.split('-');
	return `${month}/${year}`;
}
