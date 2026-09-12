export interface PayoutInput {
	dividendsTotal: number | null;
	netIncome: number | null;
	dividendsPeriod: string | null;
	netIncomePeriod: string | null;
}

export function computePayout(input: PayoutInput): number | null {
	const { dividendsTotal, netIncome, dividendsPeriod, netIncomePeriod } = input;

	if (dividendsTotal === null || netIncome === null) return null;
	if (!Number.isFinite(dividendsTotal) || !Number.isFinite(netIncome)) {
		return null;
	}
	if (!dividendsPeriod || !netIncomePeriod) return null;
	if (dividendsPeriod !== netIncomePeriod) return null;
	if (!(netIncome > 0)) return null;

	const payout = (Math.abs(dividendsTotal) / netIncome) * 100;
	return Number.isFinite(payout) ? payout : null;
}
