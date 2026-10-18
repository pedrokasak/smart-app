import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
	CohortSourcePort,
	MemberLookup,
} from 'src/benchmark/application/cohort-source.port';
import {
	MIN_HISTORY_MONTHS,
	wealthBandOf,
	type CohortLevel,
	type CohortMember,
} from 'src/benchmark/domain/cohort';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { InvestorProfileService } from 'src/intelligence/application/investor-profile/investor-profile.service';
import { UnifiedIntelligenceFacade } from 'src/intelligence/application/unified-intelligence.facade';
import type { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';
import type { PortfolioHistory } from 'src/portfolio/schema/portfolio-history.model';
import type { TradeDocument } from 'src/fiscal/schema/trade.model';
import { computeDailyCashFlows } from 'src/portfolio/history/cash-flows';
import {
	annualize,
	computeTwr,
	type DailyValuePoint,
} from 'src/portfolio/history/returns';
import type { User } from 'src/users/schema/user.model';

/** Só os campos da série diária que o benchmark lê. */
interface HistoryRow {
	date: string;
	totalValue?: number;
	investedValue?: number;
	tradingDay?: boolean;
	staleSymbols?: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 365;

const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const dayMs = (iso: string) => new Date(`${iso}T00:00:00.000Z`).getTime();

function monthsBetween(fromIso: string, to: Date): number {
	return (to.getTime() - dayMs(fromIso)) / (DAY_MS * 30.4375);
}

/**
 * Lê, de uma carteira, só o que o benchmark precisa: nível, patrimônio,
 * score de diversificação e retorno de 12 meses (ADR-003, TRA-60).
 *
 * Usa a série diária e as negociações que já existem, sem chamar provedor de
 * mercado: o retorno é o TWR sobre a janela, o mesmo cálculo da tela de
 * retornos. O membro devolvido não carrega identificação.
 */
@Injectable()
export class UserCohortSourceAdapter implements CohortSourcePort {
	private readonly logger = new Logger(UserCohortSourceAdapter.name);

	constructor(
		@InjectModel('User') private readonly userModel: Model<User>,
		@InjectModel('PortfolioHistory')
		private readonly historyModel: Model<PortfolioHistory>,
		@InjectModel('Trade') private readonly tradeModel: Model<TradeDocument>,
		private readonly portfolioService: PortfolioService,
		private readonly investorProfile: InvestorProfileService,
		private readonly intelligence: UnifiedIntelligenceFacade
	) {}

	async *members(): AsyncIterable<CohortMember> {
		const cursor = this.userModel.find({}, { _id: 1 }).lean().cursor();
		for await (const user of cursor) {
			try {
				const lookup = await this.memberFor(String((user as any)._id));
				if (lookup.eligible) yield lookup.member;
			} catch (error) {
				// Um usuário com dado ruim não pode derrubar o mês de todos.
				this.logger.warn(
					`Benchmark: carteira ignorada (${(error as Error)?.message ?? error}).`
				);
			}
		}
	}

	async memberFor(
		userId: string,
		now: Date = new Date()
	): Promise<MemberLookup> {
		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const positions = this.toPositions(portfolios);
		if (!positions.length) return { eligible: false, reason: 'no_portfolio' };

		const [rows, trades] = await Promise.all([
			this.historyModel.find({ userId }).sort({ date: 1 }).lean().exec(),
			this.tradeModel.find({ userId }).sort({ date: 1 }).lean().exec(),
		]);

		const series = this.mergeByDate(rows as unknown as HistoryRow[]);
		const flows = computeDailyCashFlows(
			trades.map((trade) => ({
				side: trade.side,
				quantity: trade.quantity,
				price: trade.price,
				fees: trade.fees,
				date: trade.date,
			}))
		);

		const full = computeTwr({ series, flows: flows.byDay });
		if (full.twr === null || !full.measuredFrom) {
			return { eligible: false, reason: 'no_return_series' };
		}
		if (monthsBetween(full.measuredFrom, now) < MIN_HISTORY_MONTHS) {
			return { eligible: false, reason: 'short_history' };
		}

		const cutoff = dayOf(new Date(now.getTime() - WINDOW_DAYS * DAY_MS));
		const window = computeTwr({
			series: series.filter((point) => point.date >= cutoff),
			flows: flows.byDay.filter((point) => point.date >= cutoff),
		});
		if (window.twr === null || !window.measuredFrom || !window.measuredTo) {
			return { eligible: false, reason: 'no_return_series' };
		}

		// Janela menor que 12 meses (histórico de 6 a 12): anualiza, para a
		// comparação não misturar retorno de 7 meses com retorno de 12.
		const days =
			(dayMs(window.measuredTo) - dayMs(window.measuredFrom)) / DAY_MS;
		const return12m =
			days >= WINDOW_DAYS - 5 ? window.twr : annualize(window.twr, days);
		if (return12m === null || !Number.isFinite(return12m)) {
			return { eligible: false, reason: 'no_return_series' };
		}

		const score = this.intelligence.getPortfolioSummary({ positions })
			?.diversification?.score;
		if (typeof score !== 'number' || !Number.isFinite(score)) {
			return { eligible: false, reason: 'no_portfolio' };
		}

		const profile = await this.investorProfile.getEffectiveProfile(userId);
		const netWorth = series[series.length - 1]?.totalValue ?? 0;

		return {
			eligible: true,
			member: {
				level: profile.sophistication as CohortLevel,
				wealthBand: wealthBandOf(netWorth),
				diversificationScore: Math.min(100, Math.max(0, score)),
				return12m,
			},
		};
	}

	/** Usuário com mais de uma carteira tem os valores do mesmo dia somados. */
	private mergeByDate(rows: HistoryRow[]): DailyValuePoint[] {
		const byDate = new Map<string, DailyValuePoint>();
		for (const row of rows) {
			const existing = byDate.get(row.date);
			if (existing) {
				existing.totalValue += row.totalValue || 0;
				existing.investedValue =
					(existing.investedValue || 0) + (row.investedValue || 0);
				existing.staleSymbols = Array.from(
					new Set([
						...(existing.staleSymbols ?? []),
						...(row.staleSymbols ?? []),
					])
				);
				continue;
			}
			byDate.set(row.date, {
				date: row.date,
				totalValue: row.totalValue || 0,
				investedValue: row.investedValue,
				tradingDay: row.tradingDay,
				staleSymbols: row.staleSymbols ?? [],
			});
		}
		return Array.from(byDate.values()).sort((a, b) =>
			a.date.localeCompare(b.date)
		);
	}

	private toPositions(portfolios: unknown[]): PortfolioIntelligencePosition[] {
		const assets = (portfolios as Array<{ assets?: unknown[] }>).flatMap(
			(portfolio) => (Array.isArray(portfolio?.assets) ? portfolio.assets : [])
		);
		return (assets as Array<Record<string, unknown>>)
			.map((asset) => ({
				symbol: String(asset?.symbol || asset?.ticker || asset?.code || '')
					.trim()
					.toUpperCase(),
				assetType: (asset?.type ||
					'other') as PortfolioIntelligencePosition['assetType'],
				quantity: Number(asset?.quantity || 0),
				totalValue:
					typeof asset?.total === 'number' && asset.total > 0
						? asset.total
						: undefined,
				price: typeof asset?.price === 'number' ? asset.price : undefined,
				currentPrice:
					typeof asset?.currentPrice === 'number'
						? asset.currentPrice
						: undefined,
				sector: typeof asset?.sector === 'string' ? asset.sector : null,
			}))
			.filter((position) => !!position.symbol);
	}
}
