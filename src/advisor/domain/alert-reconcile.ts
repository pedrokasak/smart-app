import { Alert, AlertCandidate, conditionKeyOf } from './attention.entities';
import { AlertRule, AlertStatus } from './enums';

export interface ReconcileInput {
	candidates: AlertCandidate[];
	/** Todos os alertas do cliente nos últimos 365 dias, em qualquer estado. */
	existing: Alert[];
	/** YYYY-MM-DD. */
	today: string;
}

export interface ReconcileResult {
	open: AlertCandidate[];
	update: Array<{ id: string; patch: Partial<Alert> }>;
	resolve: string[];
}

const isActive = (a: Alert): boolean =>
	a.status === AlertStatus.Open || a.status === AlertStatus.Snoozed;

const isClosedByAdvisor = (a: Alert): boolean =>
	a.status === AlertStatus.Handled || a.status === AlertStatus.Dismissed;

const closedTime = (a: Alert): number => (a.closedAt ?? a.updatedAt).getTime();

const group = <T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> => {
	const map = new Map<string, T[]>();
	for (const item of items) {
		const key = keyOf(item);
		const list = map.get(key);
		if (list) list.push(item);
		else map.set(key, [item]);
	}
	return map;
};

/** Mantém o candidato de maior banda quando duas regras geram a mesma condição. */
const dedupeCandidates = (
	candidates: AlertCandidate[]
): Map<string, AlertCandidate> => {
	const byKey = new Map<string, AlertCandidate>();
	for (const c of candidates) {
		if (c.rule === AlertRule.Manual) continue;
		const key = conditionKeyOf(c);
		const current = byKey.get(key);
		if (!current || c.band > current.band) byKey.set(key, c);
	}
	return byKey;
};

const isDueToWake = (alert: Alert, today: string): boolean =>
	alert.status === AlertStatus.Snoozed &&
	alert.snoozedUntil !== undefined &&
	alert.snoozedUntil <= today;

const WAKE_PATCH: Partial<Alert> = {
	status: AlertStatus.Open,
	snoozedUntil: undefined,
};

const updateActive = (
	alert: Alert,
	candidate: AlertCandidate,
	today: string
): Partial<Alert> => {
	if (candidate.band > alert.band) {
		return {
			band: candidate.band,
			priority: candidate.priority,
			evidence: candidate.evidence,
			dataAsOf: candidate.dataAsOf,
			lowConfidence: candidate.lowConfidence,
			status: AlertStatus.Open,
			snoozedUntil: undefined,
		};
	}
	const patch: Partial<Alert> = {
		evidence: candidate.evidence,
		dataAsOf: candidate.dataAsOf,
		lowConfidence: candidate.lowConfidence,
	};
	if (isDueToWake(alert, today)) Object.assign(patch, WAKE_PATCH);
	return patch;
};

/**
 * Decide, a cada recomputação, quais alertas abrir, atualizar ou resolver.
 * Uma condição tem no máximo um alerta ativo; depois de tratada ou
 * descartada, só reabre quando a banda piora. Um alerta `MANUAL` nunca é
 * resolvido nem atualizado; só acorda (R14): adiado com `snoozedUntil` até
 * hoje volta a OPEN.
 */
export const reconcileAlerts = ({
	candidates,
	existing,
	today,
}: ReconcileInput): ReconcileResult => {
	const result: ReconcileResult = { open: [], update: [], resolve: [] };
	const byCondition = group(
		existing.filter((a) => a.rule !== AlertRule.Manual),
		(a) => a.conditionKey
	);
	const candidateByKey = dedupeCandidates(candidates);

	for (const alert of existing) {
		if (alert.rule === AlertRule.Manual && isDueToWake(alert, today)) {
			result.update.push({ id: alert.id, patch: { ...WAKE_PATCH } });
		}
	}

	for (const [conditionKey, alerts] of byCondition) {
		const active = alerts
			.filter(isActive)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
		const candidate = candidateByKey.get(conditionKey);
		if (!candidate) {
			result.resolve.push(...active.map((a) => a.id));
			continue;
		}
		if (active.length === 0) continue;
		const [keep, ...extras] = active;
		result.update.push({
			id: keep.id,
			patch: updateActive(keep, candidate, today),
		});
		result.resolve.push(...extras.map((a) => a.id));
	}

	for (const [conditionKey, candidate] of candidateByKey) {
		const alerts = byCondition.get(conditionKey) ?? [];
		if (alerts.some(isActive)) continue;
		const lastClosed = alerts
			.filter(isClosedByAdvisor)
			.sort((a, b) => closedTime(b) - closedTime(a))[0];
		if (!lastClosed || candidate.band > lastClosed.band) {
			result.open.push(candidate);
		}
	}

	return result;
};
