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
};
