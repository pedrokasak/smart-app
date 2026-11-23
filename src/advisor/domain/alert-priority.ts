import { AlertPriority } from './enums';

/** Rank gravado nos alertas: 0 (P0, o mais grave) a 3 (P3). */
export const ALERT_PRIORITY_RANK: Record<AlertPriority, number> = {
	[AlertPriority.P0]: 0,
	[AlertPriority.P1]: 1,
	[AlertPriority.P2]: 2,
	[AlertPriority.P3]: 3,
};

export const alertPriorityRank = (priority: AlertPriority): number =>
	ALERT_PRIORITY_RANK[priority];
