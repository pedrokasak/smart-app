import { UserCountsMetric } from 'src/admin/application/user-activity-metrics';

export type PlanUsageMetric = {
	planId: string;
	planName: string;
	count: number;
};

export type AdminOverviewResponse = {
	totalActiveSubscriptions: number;
	totalTrialSubscriptions: number;
	totalManualGrants: number;
	mostUsedPlan: PlanUsageMetric | null;
	usersByPlan: PlanUsageMetric[];
	/** Contagens agregadas de usuários, sem nenhum dado pessoal (TRA-192). */
	users: UserCountsMetric;
};
