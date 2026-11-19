import type { InflationExpectations } from '../domain/inflation-expectations';

/** De onde vem a expectativa de inflação. Hoje, o Focus do BACEN. */
export const INFLATION_EXPECTATIONS_SOURCE = Symbol(
	'INFLATION_EXPECTATIONS_SOURCE'
);

export interface InflationExpectationsSource {
	/** Pesquisa mais recente; `null` quando a fonte não respondeu. */
	latest(): Promise<InflationExpectations | null>;
}
