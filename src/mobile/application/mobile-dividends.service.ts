import { Injectable } from '@nestjs/common';
import { DividendIncomeService } from 'src/dividend-income/application/dividend-income.service';
import { monthlyDividendIncome } from 'src/dividend-income/domain/dividend-income';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { UpcomingDividendsService } from 'src/portfolio/upcoming-dividends/upcoming-dividends.service';

/** Agenda de pagamentos anunciados mostrada no app. */
export const DIVIDEND_AGENDA_DAYS = 45;
const HISTORY_MONTHS = 12;

/**
 * Tela Proventos do app. Os números vêm de `DividendIncomeService`, o mesmo do
 * bloco de renda do web; as barras usam a mesma conta e somam o mesmo total.
 */
@Injectable()
export class MobileDividendsService {
	constructor(
		private readonly portfolios: PortfolioService,
		private readonly income: DividendIncomeService,
		private readonly upcomingDividends: UpcomingDividendsService
	) {}

	async getDividends(userId: string, now = new Date()) {
		const userPortfolios =
			(await this.portfolios.getUserPortfolios(userId)) || [];
		const assets = userPortfolios.flatMap((portfolio: any) =>
			Array.isArray(portfolio?.assets) ? portfolio.assets : []
		);
		const [insight, upcoming] = await Promise.all([
			this.income.insight(userId, { level: 'intermediario' }),
			this.upcomingDividends.listUpcoming(
				userId,
				userPortfolios.map((portfolio: any) => String(portfolio._id)),
				DIVIDEND_AGENDA_DAYS,
				now
			),
		]);
		const { facts, didactic } = insight;

		return {
			received12m: facts.total12m,
			monthlyAvg: facts.monthlyAvg,
			yieldOnMarketPct: facts.yieldOnMarketPct,
			yieldOnCostPct: facts.yieldOnCostPct,
			approximated: facts.approximated,
			months: monthlyDividendIncome(assets, HISTORY_MONTHS, now.getTime()),
			payers: facts.payers,
			upcoming: {
				totalNetValue: upcoming.totalNetValue,
				items: upcoming.items.map((item) => ({
					symbol: item.symbol,
					paymentType: item.paymentType,
					paymentDate: new Date(item.expectedPaymentDate)
						.toISOString()
						.slice(0, 10),
					unitValue: item.unitValue,
					netValue: item.netValue,
				})),
			},
			insight: {
				headline: didactic.answer,
				body: didactic.whyItMatters ?? didactic.meaning,
			},
		};
	}
}
