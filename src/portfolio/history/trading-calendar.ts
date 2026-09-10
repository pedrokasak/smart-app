/**
 * Calendário de pregão da B3 (TRA-143).
 *
 * ## Por que precisa existir
 *
 * O snapshot diário roda todo dia, inclusive sábado, domingo e feriado. Nesses
 * dias a cotação não muda, então a série ganha pontos que parecem "o mercado
 * ficou parado" quando na verdade não houve mercado. Qualquer cálculo de
 * retorno ou volatilidade sobre esses pontos subestima a variação: um mês com
 * 30 pontos onde só 21 são pregão dilui o desvio-padrão por construção.
 *
 * Marcar o dia permite ao consumidor decidir — o gráfico pode querer a linha
 * contínua, mas o cálculo de volatilidade e beta precisa só dos pregões.
 *
 * ## Escopo
 *
 * Feriados nacionais e os movíveis derivados da Páscoa, que é como a B3 fecha
 * na maior parte do ano. NÃO cobre: feriados estaduais de São Paulo em que a
 * B3 opera normalmente desde 2022, pontos facultativos, nem paradas não
 * programadas. Para apuração fiscal (vencimento de DARF, TRA-93) confirme a
 * lista contra a norma vigente antes de usar — aqui ela serve para classificar
 * pontos de uma série, não para determinar prazo legal.
 */

export type NonTradingReason = 'weekend' | 'holiday';

/** Feriados nacionais de data fixa, em MM-DD. */
const FIXED_HOLIDAYS = new Set([
	'01-01', // Confraternização Universal
	'04-21', // Tiradentes
	'05-01', // Dia do Trabalho
	'09-07', // Independência
	'10-12', // Nossa Senhora Aparecida
	'11-02', // Finados
	'11-15', // Proclamação da República
	'11-20', // Consciência Negra — nacional a partir de 2024 (Lei 14.759/2023)
	'12-25', // Natal
]);

/** Ano a partir do qual 20/11 é feriado nacional. */
const CONSCIENCIA_NEGRA_FROM_YEAR = 2024;

/**
 * Domingo de Páscoa pelo algoritmo de Meeus/Butcher (calendário gregoriano).
 * Determinístico e offline — nenhuma dependência ou chamada externa.
 */
export function easterSunday(year: number): Date {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = março, 4 = abril
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return new Date(Date.UTC(year, month - 1, day));
}

const shiftDays = (date: Date, days: number): Date =>
	new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const toIsoDay = (date: Date): string => date.toISOString().slice(0, 10);

const holidayCache = new Map<number, Set<string>>();

/** Feriados de um ano, em YYYY-MM-DD. Memoizado por ano. */
export function holidaysForYear(year: number): Set<string> {
	const cached = holidayCache.get(year);
	if (cached) return cached;

	const days = new Set<string>();

	for (const monthDay of FIXED_HOLIDAYS) {
		if (monthDay === '11-20' && year < CONSCIENCIA_NEGRA_FROM_YEAR) continue;
		days.add(`${year}-${monthDay}`);
	}

	const easter = easterSunday(year);
	days.add(toIsoDay(shiftDays(easter, -48))); // Carnaval (segunda)
	days.add(toIsoDay(shiftDays(easter, -47))); // Carnaval (terça)
	days.add(toIsoDay(shiftDays(easter, -2))); // Sexta-feira Santa
	days.add(toIsoDay(shiftDays(easter, 60))); // Corpus Christi

	holidayCache.set(year, days);
	return days;
}

/**
 * `null` quando o dia é de pregão; caso contrário o motivo de não ser.
 * Recebe e devolve em UTC — a data do snapshot já é YYYY-MM-DD.
 */
export function nonTradingReason(isoDay: string): NonTradingReason | null {
	const date = new Date(`${isoDay}T00:00:00.000Z`);
	if (Number.isNaN(date.getTime())) return null;

	const weekday = date.getUTCDay();
	if (weekday === 0 || weekday === 6) return 'weekend';

	const year = date.getUTCFullYear();
	if (holidaysForYear(year).has(isoDay)) return 'holiday';

	return null;
}

export function isTradingDay(isoDay: string): boolean {
	return nonTradingReason(isoDay) === null;
}
