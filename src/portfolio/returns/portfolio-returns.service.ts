import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PortfolioHistory } from 'src/portfolio/schema/portfolio-history.model';
import { TradeDocument } from 'src/fiscal/schema/trade.model';
import { computeDailyCashFlows } from 'src/portfolio/history/cash-flows';
import {
	annualize,
	computeTwr,
	computeXirr,
	decomposeContribution,
	type DailyValuePoint,
	type IrrCashFlow,
} from 'src/portfolio/history/returns';

/**
 * Monta os retornos da carteira a partir da série diária e das negociações
 * (TRA-146).
 *
 * O `Trade` é registrado localmente via `MongooseModule.forFeature`, mesmo
 * padrão já usado por `privacy.module.ts` — evita acoplar `portfolio` ao
 * `FiscalModule` inteiro só para ler negociações (CLAUDE.md §11).
 */

export interface PortfolioReturnsOutput {
	from: string | null;
	to: string | null;
	/** "Você depositou X, o mercado rendeu Y." */
	contribution: ReturnType<typeof decomposeContribution>;
	/** Retorno time-weighted: comparável com índice. */
	twr: {
		value: number | null;
		annualized: number | null;
		periods: number;
	};
	/** Retorno ponderado pelo dinheiro: qual foi o retorno do SEU capital. */
	irr: number | null;
	/**
	 * Por que algum número não pôde ser calculado. Vazio quando tudo saiu.
	 * Preferimos declarar a lacuna a devolver número confiante e errado.
	 */
	unavailable: string[];
	/** Dias da série que não tinham cotação para todos os ativos. */
	staleDays: number;
}

@Injectable()
export class PortfolioReturnsService {
	private readonly logger = new Logger(PortfolioReturnsService.name);

	constructor(
		@InjectModel('PortfolioHistory')
		private readonly historyModel: Model<PortfolioHistory>,
		@InjectModel('Trade')
		private readonly tradeModel: Model<TradeDocument>
	) {}

	async getReturns(
		userId: string,
		range?: { from?: string; to?: string }
	): Promise<PortfolioReturnsOutput> {
		const dateFilter: Record<string, string> = {};
		if (range?.from) dateFilter.$gte = range.from;
		if (range?.to) dateFilter.$lte = range.to;

		const [rows, trades] = await Promise.all([
			this.historyModel
				.find({
					userId,
					...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
				})
				.sort({ date: 1 })
				.lean()
				.exec(),
			this.tradeModel.find({ userId }).sort({ date: 1 }).lean().exec(),
		]);

		const unavailable: string[] = [];

		// Usuário com mais de um portfólio tem os valores do mesmo dia somados,
		// como já faz getUserPortfolioHistory.
		const byDate = new Map<string, DailyValuePoint>();
		let staleDays = 0;
		for (const row of rows) {
			const existing = byDate.get(row.date);
			if (existing) {
				existing.totalValue += row.totalValue || 0;
				existing.investedValue =
					(existing.investedValue || 0) + (row.investedValue || 0);
				continue;
			}
			if (row.stale) staleDays += 1;
			byDate.set(row.date, {
				date: row.date,
				totalValue: row.totalValue || 0,
				investedValue: row.investedValue,
				// Snapshot anterior a TRA-143 não tem a marcação. Tratar como
				// pregão preserva o comportamento antigo em vez de descartar o
				// ponto silenciosamente.
				tradingDay: row.tradingDay !== false,
			});
		}

		const series = Array.from(byDate.values()).sort((a, b) =>
			a.date.localeCompare(b.date)
		);

		const from = series.length ? series[0].date : null;
		const to = series.length ? series[series.length - 1].date : null;
		const currentValue = series.length
			? series[series.length - 1].totalValue
			: 0;

		const flows = computeDailyCashFlows(
			trades.map((trade) => ({
				side: trade.side,
				quantity: trade.quantity,
				price: trade.price,
				fees: trade.fees,
				date: trade.date,
			}))
		);

		if (!flows.covered) {
			// Sem negociação importada não há como saber quando o dinheiro
			// entrou. Contribuição e IRR ficam indisponíveis — projetar a
			// posição atual para trás seria ficção (precedente TRA-55).
			unavailable.push('cash_flows_missing');
		}

		const contribution = decomposeContribution({
			currentValue,
			netContribution: flows.netContribution,
		});

		const twrResult = computeTwr({ series, flows: flows.byDay });
		if (twrResult.twr === null) {
			unavailable.push('twr_insufficient_series');
		}

		let annualized: number | null = null;
		if (twrResult.twr !== null && from && to) {
			const days =
				(new Date(`${to}T00:00:00.000Z`).getTime() -
					new Date(`${from}T00:00:00.000Z`).getTime()) /
				(24 * 60 * 60 * 1000);
			annualized = annualize(twrResult.twr, days);
		}

		let irr: number | null = null;
		if (flows.covered && to && currentValue > 0) {
			const irrFlows: IrrCashFlow[] = flows.byDay.map((point) => ({
				date: point.date,
				amount: point.flow,
			}));
			// O valor atual da carteira fecha o fluxo como saída.
			irrFlows.push({ date: to, amount: -currentValue });
			irr = computeXirr(irrFlows);
			if (irr === null) unavailable.push('irr_not_solvable');
		}

		return {
			from,
			to,
			contribution,
			twr: {
				value: twrResult.twr,
				annualized,
				periods: twrResult.periods,
			},
			irr,
			unavailable,
			staleDays,
		};
	}
}
