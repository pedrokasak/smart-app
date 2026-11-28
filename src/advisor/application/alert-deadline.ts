import { Alert } from '../domain/attention.entities';
import { AlertRule, AlertStatus } from '../domain/enums';
import { alertPriorityRank } from '../domain/alert-priority';

export const ALERT_DEADLINES_MAX = 500;

const isActive = (a: Alert): boolean =>
	a.status === AlertStatus.Open || a.status === AlertStatus.Snoozed;

const within = (date: string | undefined, from: string, to: string): boolean =>
	date !== undefined && date >= from && date <= to;

/**
 * O prazo mais próximo do alerta dentro de `[from, to]`: `dueDate` de um
 * MANUAL ativo ou `snoozedUntil` de um adiado. `null` quando nenhum cai na
 * janela.
 */
export function deadlineInWindow(
	alert: Alert,
	from: string,
	to: string
): string | null {
	const dates: string[] = [];
	if (
		alert.rule === AlertRule.Manual &&
		isActive(alert) &&
		within(alert.dueDate, from, to)
	) {
		dates.push(alert.dueDate as string);
	}
	if (
		alert.status === AlertStatus.Snoozed &&
		within(alert.snoozedUntil, from, to)
	) {
		dates.push(alert.snoozedUntil as string);
	}
	return dates.length === 0 ? null : dates.sort()[0];
}

/** Do prazo mais próximo; empate por prioridade e id. Corta em 500. */
export function sortDeadlines(
	alerts: Alert[],
	from: string,
	to: string
): Alert[] {
	return alerts
		.flatMap((alert) => {
			const deadline = deadlineInWindow(alert, from, to);
			return deadline === null ? [] : [{ alert, deadline }];
		})
		.sort(
			(a, b) =>
				(a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0) ||
				alertPriorityRank(a.alert.priority) -
					alertPriorityRank(b.alert.priority) ||
				(a.alert.id < b.alert.id ? -1 : 1)
		)
		.slice(0, ALERT_DEADLINES_MAX)
		.map((x) => x.alert);
}
