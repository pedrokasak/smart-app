export type BenchmarkKey = 'CDI' | 'IBOV' | 'IPCA';

export interface BenchmarkSeriesPort {
	/** Retorno acumulado em fração entre from e to; null sem dado. Nunca lança. */
	periodReturn(
		key: BenchmarkKey,
		from: string,
		to: string
	): Promise<number | null>;
}
