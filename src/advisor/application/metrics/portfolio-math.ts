/**
 * Única porta de entrada de `src/portfolio/history` no módulo advisor. São
 * funções puras, em reais (float); quem chama converte de e para centavos.
 */
export { backfillSeries } from 'src/portfolio/history/backfill-series';
export type {
	BackfillTrade,
	BackfilledPoint,
	PriceLookup,
} from 'src/portfolio/history/backfill-series';
export { computeDailyCashFlows } from 'src/portfolio/history/cash-flows';
export type {
	CashFlowTrade,
	DailyCashFlow,
} from 'src/portfolio/history/cash-flows';
export {
	annualize,
	computeDailyReturns,
	computeTwr,
	computeXirr,
} from 'src/portfolio/history/returns';
export type { DatedReturn, IrrCashFlow } from 'src/portfolio/history/returns';
export {
	computeAnnualVolatility,
	computeDrawdown,
	computeHistoricalVar,
} from 'src/portfolio/history/risk-metrics';
export { computeConcentration } from 'src/portfolio/history/performance-metrics';
export { MIN_OBSERVATIONS } from 'src/portfolio/history/benchmark-metrics';
export { isTradingDay } from 'src/portfolio/history/trading-calendar';
