import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PortfolioHistory } from 'src/portfolio/schema/portfolio-history.model';
import { TradeDocument } from 'src/fiscal/schema/trade.model';
import { computeDailyCashFlows } from 'src/portfolio/history/cash-flows';
import {
	annualize,
	computeDailyReturns,
	computeTwr,
	computeXirr,
	decomposeContribution,
	type DailyValuePoint,
	type IrrCashFlow,
} from 'src/portfolio/history/returns';
import {
	closesToReturns,
	computeBenchmarkMetrics,
} from 'src/portfolio/history/benchmark-metrics';
import {
	MARKET_DATA_PROVIDER,
	type MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import {
	computeDrawdown,
	computeHistoricalVar,
	computeSharpe,
	type DrawdownResult,
	type HistoricalVarResult,
	type SharpeResult,
} from 'src/portfolio/history/risk-metrics';
import {
	RISK_FREE_RATE_PROVIDER,
	type RiskFreeRatePort,
} from './risk-free-rate.port';
import { PortfolioService } from 'src/portfolio/portfolio.service';

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
	 * Sensibilidade e aderência ao IBOV (TRA-141). Voltaram a existir quando
	 * TRA-143 corrigiu a série diária; antes disso eram `'—'` fixo na tela.
	 */
	benchmark: {
		symbol: string;
		/** Nome do índice para a tela: `IBOV`, `IFIX`. */
		label: string;
		beta: number | null;
		trackingError: number | null;
		correlation: number | null;
		observations: number;
		upBeta: number | null;
		downBeta: number | null;
		portfolioReturn: number | null;
		benchmarkReturn: number | null;
		alpha: number | null;
	};
	/**
	 * Risco do nível avançado do handoff: Sharpe (rf = CDI), VaR 95% 21d
	 * histórico e máximo drawdown, todos sobre retorno ajustado por fluxo.
	 */
	risk: {
		sharpe: SharpeResult;
		valueAtRisk: HistoricalVarResult;
		drawdown: DrawdownResult;
	};
	/**
	 * Por que algum número não pôde ser calculado. Vazio quando tudo saiu.
	 * Preferimos declarar a lacuna a devolver número confiante e errado.
	 */
	unavailable: string[];
	/** Dias da série que não tinham cotação para todos os ativos. */
	staleDays: number;
}

/**
 * Índices de referência no Yahoo, por perfil de carteira (TRA-141).
 *
 * Beta contra o IBOV engana quem tem muito FII: fundo imobiliário segue o
 * IFIX e a curva de juros, não a bolsa. Uma carteira 60% FII exibia beta
 * baixo e passava a impressão de "defensiva", quando o risco era de juros.
 *
 * A escolha é pelo que domina a carteira, e o índice usado vai no payload —
 * a tela mostra o nome, em vez de assumir IBOV.
 */
const IBOV = { symbol: '^BVSP', label: 'IBOV' } as const;
const IFIX = { symbol: '^IFIX', label: 'IFIX' } as const;
/** Acima disto o FII manda na carteira e o IBOV deixa de ser referência. */
const FII_DOMINANCE_PCT = 50;
/** Janela pedida ao provedor. Um ano cobre os 252 pregões da anualização. */
const BENCHMARK_RANGE = '1y';

@Injectable()
export class PortfolioReturnsService {
	private readonly logger = new Logger(PortfolioReturnsService.name);

	constructor(
		@InjectModel('PortfolioHistory')
		private readonly historyModel: Model<PortfolioHistory>,
		@InjectModel('Trade')
		private readonly tradeModel: Model<TradeDocument>,
		@Inject(MARKET_DATA_PROVIDER)
		private readonly marketData: MarketDataProviderPort,
		@Inject(RISK_FREE_RATE_PROVIDER)
		private readonly riskFreeRate: RiskFreeRatePort,
		private readonly portfolioService: PortfolioService
	) {}

	/** Peso de FII na carteira, a valor de mercado. 0 quando não dá pra saber. */
	private async fiiSharePct(userId: string): Promise<number> {
		try {
			const portfolios = await this.portfolioService.getUserPortfolios(userId);
			const assets = (portfolios || []).flatMap((portfolio: any) =>
				Array.isArray(portfolio?.assets) ? portfolio.assets : []
			);
			let total = 0;
			let fii = 0;
			for (const asset of assets) {
				const quantity = Number(asset?.quantity) || 0;
				const price = Number(asset?.currentPrice) || Number(asset?.price) || 0;
				const value = quantity * price;
				if (!(value > 0)) continue;
				total += value;
				if (String(asset?.type) === 'fii') fii += value;
			}
			return total > 0 ? (fii / total) * 100 : 0;
		} catch (error) {
			this.logger.warn(
				`Não foi possível medir a fatia de FII: ${(error as Error)?.message || error}`
			);
			return 0;
		}
	}

	/**
	 * Escolhe o índice e busca a série. Se o índice preferido não vier (o
	 * provedor pode não ter o IFIX), cai para o IBOV e avisa — nunca devolve
	 * beta contra um índice que não foi o usado.
	 */
	private async resolveBenchmark(userId: string): Promise<{
		symbol: string;
		label: string;
		closes: { date: string; close: number }[];
		fallback: boolean;
	}> {
		const fiiShare = await this.fiiSharePct(userId);
		const preferred = fiiShare > FII_DOMINANCE_PCT ? IFIX : IBOV;

		const closes = await this.marketData.getDailyCloses(
			preferred.symbol,
			BENCHMARK_RANGE
		);
		if (closes.length || preferred.symbol === IBOV.symbol) {
			return { ...preferred, closes, fallback: false };
		}

		this.logger.warn(
			`Série de ${preferred.label} indisponível; usando ${IBOV.label} como referência.`
		);
		const ibovCloses = await this.marketData.getDailyCloses(
			IBOV.symbol,
			BENCHMARK_RANGE
		);
		return { ...IBOV, closes: ibovCloses, fallback: true };
	}

	/** CDI diário em fração, para o período dos retornos. Falha vira série vazia. */
	private async fetchRiskFreeDaily(
		from: string | undefined,
		to: string | undefined
	): Promise<{ date: string; value: number }[]> {
		if (!from || !to) return [];
		try {
			const { series } = await this.riskFreeRate.getCdiSeries(
				new Date(`${from}T00:00:00.000Z`),
				new Date(`${to}T00:00:00.000Z`)
			);
			return (series || []).map((point) => ({
				date: point.date,
				value: point.value / 100,
			}));
		} catch (error) {
			this.logger.warn(
				`CDI indisponível para o Sharpe: ${(error as Error)?.message || error}`
			);
			return [];
		}
	}

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

		// Beta e tracking error contra o IBOV (TRA-141). Os retornos da carteira
		// vêm ajustados por fluxo: sem isso o beta mediria o calendário de
		// aportes do usuário em vez da sensibilidade ao índice.
		const { returns: portfolioReturns } = computeDailyReturns({
			series,
			flows: flows.byDay,
		});
		const [benchmark, riskFreeDaily] = await Promise.all([
			this.resolveBenchmark(userId),
			this.fetchRiskFreeDaily(
				portfolioReturns[0]?.date,
				portfolioReturns[portfolioReturns.length - 1]?.date
			),
		]);
		if (benchmark.fallback) {
			unavailable.push('benchmark_preferred_index_unavailable');
		}
		const benchmarkMetrics = computeBenchmarkMetrics(
			portfolioReturns,
			closesToReturns(benchmark.closes)
		);
		if (benchmarkMetrics.unavailable) {
			unavailable.push(`benchmark_${benchmarkMetrics.unavailable}`);
		}

		const sharpe = computeSharpe(portfolioReturns, riskFreeDaily);
		if (sharpe.sharpe === null) unavailable.push('sharpe_insufficient_data');
		const valueAtRisk = computeHistoricalVar(portfolioReturns, {
			portfolioValue: currentValue,
		});
		if (valueAtRisk.varPct === null) {
			unavailable.push('var_insufficient_windows');
		}
		const drawdown = computeDrawdown(portfolioReturns);

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
			benchmark: {
				symbol: benchmark.symbol,
				label: benchmark.label,
				beta: benchmarkMetrics.beta,
				trackingError: benchmarkMetrics.trackingError,
				correlation: benchmarkMetrics.correlation,
				observations: benchmarkMetrics.observations,
				upBeta: benchmarkMetrics.upBeta,
				downBeta: benchmarkMetrics.downBeta,
				portfolioReturn: benchmarkMetrics.portfolioReturn,
				benchmarkReturn: benchmarkMetrics.benchmarkReturn,
				alpha: benchmarkMetrics.alpha,
			},
			risk: { sharpe, valueAtRisk, drawdown },
			unavailable,
			staleDays,
		};
	}
}
