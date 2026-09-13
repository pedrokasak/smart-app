/**
 * Fonte da taxa livre de risco usada no Sharpe (TRA-141).
 *
 * Port em vez de injetar `StockService` direto: o returns service só precisa
 * da série do CDI, não do módulo de ações inteiro, e a fonte (hoje BACEN SGS
 * 12) pode mudar sem tocar no cálculo.
 */
export const RISK_FREE_RATE_PROVIDER = Symbol('RISK_FREE_RATE_PROVIDER');

export interface RiskFreeRatePort {
	/** Série diária em PERCENTUAL ao dia (0,0397 = 0,0397% a.d.), como o BACEN. */
	getCdiSeries(
		from: Date,
		to: Date
	): Promise<{ series: Array<{ date: string; value: number }> }>;
}
