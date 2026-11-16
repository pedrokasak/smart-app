import {
	AssetClass,
	LiquidityBucket,
	PortfolioProvenance,
	TransactionSide,
} from '../../domain/enums';
import { Transaction } from '../../domain/portfolio.entities';
import { derivePositions, sortLedger } from '../../domain/positions';
import {
	allocationByClass,
	allocationDrift,
	liquidityBreakdown,
	portfolioProvenance,
	topPositions,
	ValuedPosition,
	valuePositions,
} from '../../domain/snapshot-metrics';
import type { BenchmarkKey } from '../ports/benchmark-series.port';
import type { DailyCloseMinor } from '../ports/price-history.port';
import {
	annualize,
	backfillSeries,
	BackfillTrade,
	computeAnnualVolatility,
	computeConcentration,
	computeDailyCashFlows,
	computeDailyReturns,
	computeDrawdown,
	computeHistoricalVar,
	computeTwr,
	computeXirr,
	DailyCashFlow,
	DatedReturn,
	MIN_OBSERVATIONS,
	PriceLookup,
} from './portfolio-math';

export type Unavailable =
	| 'NO_TRANSACTIONS'
	| 'INCONSISTENT_LEDGER'
	| 'NO_PRICED_POSITIONS'
	| 'INSUFFICIENT_HISTORY';

export interface ClientPortfolioMetrics {
	asOf: string;
	currency: 'BRL';
	provenance: PortfolioProvenance | null;
	totalValueMinor: number;
	positions: ValuedPosition[];
	concentration: {
		hhi: number | null;
		effectiveAssets: number | null;
		top: Array<{ symbol: string; weightPct: number }>;
	};
	liquidity: Record<LiquidityBucket, number>;
	allocation: {
		current: Record<AssetClass, number>;
		target: Partial<Record<AssetClass, number>> | null;
		driftPp: Record<AssetClass, number> | null;
	};
	performance: {
		twr: number | null;
		twrAnnualized: number | null;
		mwr: number | null;
		measuredFrom: string | null;
		measuredTo: string | null;
		observations: number;
		unavailable: Unavailable | null;
	};
	risk: {
		volatilityAnnualized: number | null;
		maxDrawdown: number | null;
		drawdownPeakDate: string | null;
		drawdownTroughDate: string | null;
		var95: { pct: number; amountMinor: number; horizonDays: 21 } | null;
		unavailable: Unavailable | null;
	};
	benchmarks: Array<{
		key: BenchmarkKey;
		periodReturn: number | null;
		excess: number | null;
	}>;
	warnings: { unpricedSymbols: string[]; ledgerInconsistencies: string[] };
}

export interface PortfolioMetricsInput {
	asOf: string;
	ledger: Transaction[];
	/** Por símbolo. */
	closes: Map<string, DailyCloseMinor[]>;
	target: Partial<Record<AssetClass, number>> | null;
	/** Já na janela medida. */
	benchmarkReturns: Partial<Record<BenchmarkKey, number | null>>;
}

export const BENCHMARK_KEYS: BenchmarkKey[] = ['CDI', 'IBOV', 'IPCA'];

const TOP_POSITIONS = 5;
const VAR_HORIZON_DAYS = 21;
const VAR_CONFIDENCE = 0.95;
const ANNUALIZE_FROM_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toReais = (minor: number): number => minor / 100;

const daysBetween = (from: string, to: string): number =>
	Math.round(
		(new Date(`${to}T00:00:00.000Z`).getTime() -
			new Date(`${from}T00:00:00.000Z`).getTime()) /
			MS_PER_DAY
	);

const validCloses = (
	closes: DailyCloseMinor[] | undefined,
	asOf: string
): DailyCloseMinor[] =>
	(closes ?? []).filter(
		(c) => c.date <= asOf && Number.isFinite(c.closeMinor) && c.closeMinor > 0
	);

function lastCloses(
	closes: Map<string, DailyCloseMinor[]>,
	asOf: string
): Map<string, number> {
	const last = new Map<string, number>();
	for (const [symbol, series] of closes) {
		const sorted = validCloses(series, asOf).sort((a, b) =>
			a.date.localeCompare(b.date)
		);
		if (sorted.length > 0) {
			last.set(symbol, sorted[sorted.length - 1].closeMinor);
		}
	}
	return last;
}

interface SeriesAnalysis {
	unavailable: Unavailable | null;
	returns: DatedReturn[];
	flows: DailyCashFlow[];
	twr: number | null;
	measuredFrom: string | null;
	measuredTo: string | null;
}

/** Série em reais: a única parte do cálculo que sai de centavos. */
function analyseSeries(input: {
	asOf: string;
	ledger: Transaction[];
	closes: Map<string, DailyCloseMinor[]>;
}): SeriesAnalysis {
	const empty = (unavailable: Unavailable): SeriesAnalysis => ({
		unavailable,
		returns: [],
		flows: [],
		twr: null,
		measuredFrom: null,
		measuredTo: null,
	});
	if (input.ledger.length === 0) return empty('NO_TRANSACTIONS');
	// Venda descoberta: a série limitaria a venda ao saldo, mas o fluxo
	// registraria a retirada inteira, e a retirada fantasma viraria retorno.
	if (derivePositions(input.ledger).inconsistencies.length > 0) {
		return empty('INCONSISTENT_LEDGER');
	}

	// Mesma ordem do snapshot: no mesmo dia, compra antes de venda.
	const ledger = sortLedger(input.ledger);
	const symbols = new Set(ledger.map((t) => t.symbol));
	const prices: PriceLookup = new Map();
	for (const symbol of symbols) {
		const series = validCloses(input.closes.get(symbol), input.asOf);
		if (series.length === 0) continue;
		prices.set(
			symbol,
			new Map(series.map((c) => [c.date, toReais(c.closeMinor)]))
		);
	}
	if (prices.size === 0) return empty('NO_PRICED_POSITIONS');

	const trades: Array<BackfillTrade & { fees: number }> = ledger.map((t) => ({
		symbol: t.symbol,
		side: t.side === TransactionSide.Buy ? 'buy' : 'sell',
		quantity: t.quantity,
		price: toReais(t.unitPriceMinor),
		fees: toReais(t.feesMinor),
		date: t.tradeDate,
	}));
	const points = backfillSeries({ trades, prices, until: input.asOf }).points;
	const flows = computeDailyCashFlows(trades).byDay;
	const { returns } = computeDailyReturns({ series: points, flows });

	if (returns.length < MIN_OBSERVATIONS) {
		return { ...empty('INSUFFICIENT_HISTORY'), returns, flows };
	}
	const twr = computeTwr({ series: points, flows });
	return {
		unavailable: null,
		returns,
		flows,
		twr: twr.twr,
		measuredFrom: twr.measuredFrom,
		measuredTo: twr.measuredTo,
	};
}

/** Janela que o serviço precisa buscar antes de chamar buildPortfolioMetrics. */
export function measuredWindow(input: {
	asOf: string;
	ledger: Transaction[];
	closes: Map<string, DailyCloseMinor[]>;
}): { from: string; to: string } | null {
	const series = analyseSeries(input);
	if (!series.measuredFrom || !series.measuredTo) return null;
	return { from: series.measuredFrom, to: series.measuredTo };
}

function moneyWeightedReturn(
	flows: DailyCashFlow[],
	asOf: string,
	totalValueMinor: number
): number | null {
	const irrFlows = flows.map((f) => ({ date: f.date, amount: f.flow }));
	if (totalValueMinor > 0) {
		irrFlows.push({ date: asOf, amount: -toReais(totalValueMinor) });
	}
	return computeXirr(irrFlows);
}

export function buildPortfolioMetrics(
	input: PortfolioMetricsInput
): ClientPortfolioMetrics {
	const { positions, inconsistencies } = derivePositions(input.ledger);
	const valued = valuePositions(
		positions,
		lastCloses(input.closes, input.asOf)
	);
	const totalValueMinor = valued.reduce(
		(sum, p) => sum + p.marketValueMinor,
		0
	);
	const concentration = computeConcentration(
		valued.map((p) => p.marketValueMinor)
	);
	const current = allocationByClass(valued);

	const series = analyseSeries(input);
	const measured = series.unavailable === null;

	const twrAnnualized =
		measured &&
		series.twr !== null &&
		daysBetween(series.measuredFrom, series.measuredTo) >= ANNUALIZE_FROM_DAYS
			? annualize(
					series.twr,
					daysBetween(series.measuredFrom, series.measuredTo)
				)
			: null;

	const volatility = measured
		? computeAnnualVolatility(series.returns).annualized
		: null;
	const drawdown = measured ? computeDrawdown(series.returns) : null;
	const historicalVar = measured
		? computeHistoricalVar(series.returns, {
				portfolioValue: toReais(totalValueMinor),
				horizonDays: VAR_HORIZON_DAYS,
				confidence: VAR_CONFIDENCE,
			})
		: null;

	return {
		asOf: input.asOf,
		currency: 'BRL',
		provenance: portfolioProvenance(positions),
		totalValueMinor,
		positions: valued,
		concentration: {
			hhi: concentration.hhi,
			effectiveAssets: concentration.effectiveAssets,
			top: topPositions(valued, TOP_POSITIONS),
		},
		liquidity: liquidityBreakdown(valued),
		allocation: {
			current,
			target: input.target ?? null,
			driftPp: input.target ? allocationDrift(current, input.target) : null,
		},
		performance: {
			twr: series.twr,
			twrAnnualized,
			mwr: measured
				? moneyWeightedReturn(series.flows, input.asOf, totalValueMinor)
				: null,
			measuredFrom: series.measuredFrom,
			measuredTo: series.measuredTo,
			observations: series.returns.length,
			unavailable: series.unavailable,
		},
		risk: {
			volatilityAnnualized: volatility,
			maxDrawdown: drawdown ? drawdown.maxDrawdown : null,
			drawdownPeakDate: drawdown ? drawdown.peakDate : null,
			drawdownTroughDate: drawdown ? drawdown.troughDate : null,
			var95:
				historicalVar && historicalVar.varPct !== null
					? {
							pct: historicalVar.varPct,
							amountMinor: Math.round(historicalVar.amount * 100),
							horizonDays: VAR_HORIZON_DAYS,
						}
					: null,
			unavailable: series.unavailable,
		},
		benchmarks: BENCHMARK_KEYS.map((key) => {
			const periodReturn = input.benchmarkReturns[key] ?? null;
			return {
				key,
				periodReturn,
				excess:
					series.twr !== null && periodReturn !== null
						? series.twr - periodReturn
						: null,
			};
		}),
		warnings: {
			unpricedSymbols: valued
				.filter((p) => !p.priced)
				.map((p) => p.symbol)
				.sort(),
			ledgerInconsistencies: inconsistencies,
		},
	};
}
