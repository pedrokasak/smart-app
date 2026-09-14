/**
 * Quando cada agendamento roda. Tudo às 08:00 de Brasília (11:00 UTC; o
 * Brasil não tem horário de verão desde 2019):
 * - semanal: segunda-feira;
 * - mensal: dia 1;
 * - trimestral: dia 1 de jan/abr/jul/out;
 * - anual: 5 de janeiro, depois do fechamento de dezembro.
 */
export const SCHEDULE_FREQUENCIES = [
	'weekly',
	'monthly',
	'quarterly',
	'yearly',
] as const;

export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

const RUN_HOUR_UTC = 11;

const at = (year: number, month: number, day: number) =>
	new Date(Date.UTC(year, month, day, RUN_HOUR_UTC));

/** Próxima execução estritamente depois de `after`. */
export function nextRunAt(frequency: ScheduleFrequency, after: Date): Date {
	const year = after.getUTCFullYear();
	const month = after.getUTCMonth();

	switch (frequency) {
		case 'weekly': {
			const candidate = at(year, month, after.getUTCDate());
			const daysUntilMonday = (8 - candidate.getUTCDay()) % 7;
			candidate.setUTCDate(candidate.getUTCDate() + daysUntilMonday);
			if (candidate <= after) candidate.setUTCDate(candidate.getUTCDate() + 7);
			return candidate;
		}
		case 'monthly': {
			const candidate = at(year, month, 1);
			return candidate > after ? candidate : at(year, month + 1, 1);
		}
		case 'quarterly': {
			const quarterStart = Math.floor(month / 3) * 3;
			const candidate = at(year, quarterStart, 1);
			return candidate > after ? candidate : at(year, quarterStart + 3, 1);
		}
		case 'yearly': {
			const candidate = at(year, 0, 5);
			return candidate > after ? candidate : at(year + 1, 0, 5);
		}
	}
}

/**
 * Ano-base do relatório entregue em `runAt`: a entrega anual de janeiro e a
 * mensal/trimestral/semanal do começo de janeiro fecham o ano anterior.
 */
export function reportYearFor(
	frequency: ScheduleFrequency,
	runAt: Date
): number {
	const year = runAt.getUTCFullYear();
	if (frequency === 'yearly') return year - 1;
	return runAt.getUTCMonth() === 0 && runAt.getUTCDate() <= 7 ? year - 1 : year;
}
