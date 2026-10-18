/**
 * Métricas de receita e retenção do dashboard admin (TRA-158), calculadas
 * sobre o espelho local das assinaturas — mantido pelos webhooks do Stripe e
 * do Asaas (CLAUDE.md §4.4: o banco local pode espelhar para consulta
 * rápida; a fonte comercial continua sendo o provedor).
 *
 * Só receita recorrente paga entra no MRR: concessão manual e trial não
 * pagam. Nenhum dado pessoal sai daqui — os sinais levam plano e data, nunca
 * e-mail ou nome (CLAUDE.md §8).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Período maior que isto é cobrança anual (o espelho não grava o intervalo). */
const ANNUAL_PERIOD_DAYS = 300;
const SIGNALS_LIMIT = 8;

export interface AnalyticsPlan {
	id: string;
	name: string;
	price: number;
	annualPrice?: number | null;
}

export interface AnalyticsSubscription {
	planId: string;
	status: 'active' | 'canceled' | 'past_due' | 'unpaid' | 'trialing' | 'paused';
	paymentProvider?: 'stripe' | 'asaas_pix' | 'manual' | null;
	currentPeriodStart: Date;
	currentPeriodEnd: Date;
	createdAt?: Date | null;
	canceledAt?: Date | null;
	endedAt?: Date | null;
	updatedAt?: Date | null;
}

export type SeriesGranularity = 'day' | 'week' | 'month';

export interface AdminAnalytics {
	mrr: { value: number; previous: number; deltaPct: number | null };
	averageTicket: { value: number | null; previous: number | null };
	monthlyChurnPct: { value: number | null; previous: number | null };
	/** Ticket ÷ churn mensal; `null` sem churn medido (seria infinito). */
	averageLtv: number | null;
	payingCustomers: number;
	activeCustomers: Record<
		SeriesGranularity,
		Array<{ label: string; count: number }>
	>;
	planBreakdown: Array<{
		planId: string;
		planName: string;
		count: number;
		pct: number;
	}>;
	/** Motivo de cancelamento não é coletado hoje. */
	churnReasons: { available: false };
	signals: Array<{
		kind: 'new_subscription' | 'cancellation' | 'payment_issue';
		planName: string;
		at: string;
	}>;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

const endOf = (sub: AnalyticsSubscription): number | null => {
	const end =
		sub.endedAt ?? (sub.status === 'canceled' ? sub.canceledAt : null);
	return end ? end.getTime() : null;
};

/** Ativa (paga ou não) num instante: começou antes e não tinha terminado. */
function activeAt(sub: AnalyticsSubscription, at: number): boolean {
	const start = (sub.createdAt ?? sub.currentPeriodStart).getTime();
	if (start > at) return false;
	const end = endOf(sub);
	if (end !== null) return end > at;
	return ['active', 'trialing', 'past_due'].includes(sub.status);
}

const paying = (sub: AnalyticsSubscription) =>
	sub.paymentProvider !== 'manual' && sub.status !== 'trialing';

function monthlyValue(
	sub: AnalyticsSubscription,
	plan: AnalyticsPlan | undefined
): number {
	if (!plan) return 0;
	const periodDays =
		(sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime()) /
		DAY_MS;
	if (periodDays > ANNUAL_PERIOD_DAYS) {
		return (plan.annualPrice ?? plan.price * 12) / 12;
	}
	return plan.price;
}

function snapshot(
	subs: AnalyticsSubscription[],
	plans: Map<string, AnalyticsPlan>,
	at: number
) {
	const payingNow = subs.filter((sub) => paying(sub) && activeAt(sub, at));
	const mrr = payingNow.reduce(
		(sum, sub) => sum + monthlyValue(sub, plans.get(sub.planId)),
		0
	);
	return {
		mrr,
		payingCount: payingNow.length,
		ticket: payingNow.length ? mrr / payingNow.length : null,
	};
}

/** Saídas nos 30 dias até `at` sobre as pagantes ativas 30 dias antes. */
function churnAt(subs: AnalyticsSubscription[], at: number): number | null {
	const from = at - 30 * DAY_MS;
	const base = subs.filter((sub) => paying(sub) && activeAt(sub, from));
	if (!base.length) return null;
	const lost = base.filter((sub) => {
		const end = endOf(sub);
		return end !== null && end > from && end <= at;
	}).length;
	return (lost / base.length) * 100;
}

function series(
	subs: AnalyticsSubscription[],
	now: Date,
	granularity: SeriesGranularity
): Array<{ label: string; count: number }> {
	const points: Array<{ label: string; count: number }> = [];
	const count = granularity === 'day' ? 30 : granularity === 'week' ? 12 : 12;
	for (let i = count - 1; i >= 0; i--) {
		const at = new Date(now);
		if (granularity === 'day') at.setDate(at.getDate() - i);
		else if (granularity === 'week') at.setDate(at.getDate() - i * 7);
		else at.setMonth(at.getMonth() - i);
		const label =
			granularity === 'month'
				? `${String(at.getMonth() + 1).padStart(2, '0')}/${at.getFullYear()}`
				: `${String(at.getDate()).padStart(2, '0')}/${String(at.getMonth() + 1).padStart(2, '0')}`;
		points.push({
			label,
			count: subs.filter((sub) => activeAt(sub, at.getTime())).length,
		});
	}
	return points;
}

export function computeAdminAnalytics(
	subs: AnalyticsSubscription[],
	planList: AnalyticsPlan[],
	now: Date = new Date()
): AdminAnalytics {
	const plans = new Map(planList.map((plan) => [plan.id, plan]));
	const at = now.getTime();
	const monthAgo = at - 30 * DAY_MS;
	const current = snapshot(subs, plans, at);
	const previous = snapshot(subs, plans, monthAgo);
	const churn = churnAt(subs, at);
	const previousChurn = churnAt(subs, monthAgo);

	const activeNow = subs.filter((sub) => activeAt(sub, at));
	const byPlan = new Map<string, number>();
	for (const sub of activeNow)
		byPlan.set(sub.planId, (byPlan.get(sub.planId) ?? 0) + 1);
	const planBreakdown = [...byPlan.entries()]
		.map(([planId, count]) => ({
			planId,
			planName: plans.get(planId)?.name ?? 'Plano removido',
			count,
			pct: round2((count / activeNow.length) * 100),
		}))
		.sort((a, b) => b.count - a.count);

	const signals: AdminAnalytics['signals'] = [];
	for (const sub of subs) {
		const planName = plans.get(sub.planId)?.name ?? 'Plano removido';
		const created = sub.createdAt?.getTime();
		if (created && created >= monthAgo) {
			signals.push({
				kind: 'new_subscription',
				planName,
				at: new Date(created).toISOString(),
			});
		}
		const end = endOf(sub);
		if (end !== null && end >= monthAgo) {
			signals.push({
				kind: 'cancellation',
				planName,
				at: new Date(end).toISOString(),
			});
		}
		if (
			(sub.status === 'past_due' || sub.status === 'unpaid') &&
			sub.updatedAt
		) {
			signals.push({
				kind: 'payment_issue',
				planName,
				at: sub.updatedAt.toISOString(),
			});
		}
	}
	signals.sort((a, b) => b.at.localeCompare(a.at));

	return {
		mrr: {
			value: round2(current.mrr),
			previous: round2(previous.mrr),
			deltaPct:
				previous.mrr > 0
					? round2(((current.mrr - previous.mrr) / previous.mrr) * 100)
					: null,
		},
		averageTicket: {
			value: current.ticket === null ? null : round2(current.ticket),
			previous: previous.ticket === null ? null : round2(previous.ticket),
		},
		monthlyChurnPct: {
			value: churn === null ? null : round2(churn),
			previous: previousChurn === null ? null : round2(previousChurn),
		},
		averageLtv:
			current.ticket !== null && churn !== null && churn > 0
				? round2(current.ticket / (churn / 100))
				: null,
		payingCustomers: current.payingCount,
		activeCustomers: {
			day: series(subs, now, 'day'),
			week: series(subs, now, 'week'),
			month: series(subs, now, 'month'),
		},
		planBreakdown,
		churnReasons: { available: false },
		signals: signals.slice(0, SIGNALS_LIMIT),
	};
}
