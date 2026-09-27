/**
 * Fonte do IPCA usado no retorno real (TRA-227).
 *
 * Port pelo mesmo motivo do `RiskFreeRatePort`: o cálculo de retornos só
 * precisa da série mensal, não do módulo macro inteiro.
 */
export const INFLATION_PROVIDER = Symbol('INFLATION_PROVIDER');

export interface InflationSeries {
	/** IPCA mensal em PERCENTUAL, `date` = dia 01 do mês de referência. */
	points: Array<{ date: string; value: number }>;
	/** Procedência: quando foi lido na origem e como reproduzir a consulta. */
	extractedAt: Date | null;
	sourceUrl: string;
}

export interface InflationPort {
	getMonthlyIpca(from: string, to: string): Promise<InflationSeries>;
}
