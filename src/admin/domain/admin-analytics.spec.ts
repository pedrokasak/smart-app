import {
	type AnalyticsPlan,
	type AnalyticsSubscription,
	computeAdminAnalytics,
} from './admin-analytics';

const NOW = new Date(2026, 9, 15, 12);
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

const plans: AnalyticsPlan[] = [
	{ id: 'pro', name: 'Pro', price: 29.9, annualPrice: 299 },
	{ id: 'wealth', name: 'Wealth', price: 59.9 },
];

const sub = (
	overrides: Partial<AnalyticsSubscription>
): AnalyticsSubscription => ({
	planId: 'pro',
	status: 'active',
	paymentProvider: 'stripe',
	currentPeriodStart: daysAgo(10),
	currentPeriodEnd: new Date(daysAgo(10).getTime() + 30 * 86_400_000),
	createdAt: daysAgo(100),
	...overrides,
});

describe('computeAdminAnalytics (TRA-158)', () => {
	const subs = [
		sub({}),
		sub({ planId: 'wealth' }),
		// Anual: R$ 299 / 12 no MRR.
		sub({
			currentPeriodStart: daysAgo(30),
			currentPeriodEnd: new Date(daysAgo(30).getTime() + 365 * 86_400_000),
		}),
		// Concessão manual e trial não pagam.
		sub({ paymentProvider: 'manual' }),
		sub({ status: 'trialing', createdAt: daysAgo(3) }),
		// Cancelou há 10 dias: estava na base de 30 dias atrás.
		sub({ status: 'canceled', canceledAt: daysAgo(10), endedAt: daysAgo(10) }),
		// Nova há 5 dias: não estava 30 dias atrás.
		sub({ createdAt: daysAgo(5), currentPeriodStart: daysAgo(5) }),
	];

	const result = computeAdminAnalytics(subs, plans, NOW);

	it('MRR counts only paid recurring revenue, annual divided by 12', () => {
		// 29,9 + 59,9 + 299/12 + 29,9 (nova)
		expect(result.mrr.value).toBeCloseTo(29.9 + 59.9 + 299 / 12 + 29.9, 2);
		// 30 dias atrás: as três antigas + a que cancelou depois.
		expect(result.mrr.previous).toBeCloseTo(29.9 + 59.9 + 299 / 12 + 29.9, 2);
		expect(result.payingCustomers).toBe(4);
	});

	it('monthly churn and LTV', () => {
		// Base 30 dias atrás: 4 pagantes; 1 saiu.
		expect(result.monthlyChurnPct.value).toBe(25);
		expect(result.averageLtv).toBeCloseTo(
			(result.averageTicket.value as number) / 0.25,
			1
		);
	});

	it('plan breakdown in percent over every active subscription', () => {
		const pro = result.planBreakdown.find((p) => p.planId === 'pro');
		expect(pro?.count).toBe(5);
		expect(result.planBreakdown.reduce((sum, p) => sum + p.pct, 0)).toBeCloseTo(
			100,
			0
		);
	});

	it('recent signals carry plan and date only, newest first', () => {
		expect(result.signals[0]).toEqual({
			kind: 'new_subscription',
			planName: 'Pro',
			at: daysAgo(3).toISOString(),
		});
		expect(result.signals.some((s) => s.kind === 'cancellation')).toBe(true);
		expect(JSON.stringify(result.signals)).not.toMatch(/@|email|user/i);
	});

	it('active customers series per day, week and month, last point = today', () => {
		expect(result.activeCustomers.day).toHaveLength(30);
		expect(result.activeCustomers.week).toHaveLength(12);
		expect(result.activeCustomers.month).toHaveLength(12);
		expect(result.activeCustomers.day.at(-1)?.count).toBe(6);
	});

	it('without history there is no churn, no LTV and no delta', () => {
		const empty = computeAdminAnalytics([], plans, NOW);
		expect(empty.mrr).toEqual({ value: 0, previous: 0, deltaPct: null });
		expect(empty.monthlyChurnPct.value).toBeNull();
		expect(empty.averageLtv).toBeNull();
		expect(empty.churnReasons).toEqual({ available: false });
	});
});
