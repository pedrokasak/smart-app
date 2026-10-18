import type { BankInstrumentKind } from './fixed-income-tax';
import type { Indexer } from './instrument';

/**
 * Posição de renda fixa na carteira (TRA-230). Diferente dos outros ativos,
 * não tem cotação: o valor sai do principal, do indexador e do tempo, e
 * nunca é `quantidade × preço`.
 *
 * Usa o vocabulário do comparador (TRA-269): mesmo `Indexer`, mesmos tipos de
 * papel, mesma regra de IR.
 */
export type PositionKind = BankInstrumentKind | 'TESOURO';

export interface FixedIncomePosition {
	kind: PositionKind;
	indexer: Indexer;
	/** Significado de `Instrument.ratePct`: % do CDI, spread ou taxa a.a. */
	ratePct: number;
	/** Valor aplicado, em reais. */
	principal: number;
	/** Data da aplicação, YYYY-MM-DD. */
	appliedAt: string;
	/** Vencimento, YYYY-MM-DD. Depois dele o valor para de render. */
	maturityDate?: string | null;
}

/** Ponto de série de taxa: variação do período em PERCENTUAL. */
export interface IndexRatePoint {
	/** YYYY-MM-DD; série mensal usa o dia 01. */
	date: string;
	value: number;
}

export interface IndexSeries {
	/** CDI diário (SGS 12), % ao dia. */
	cdiDaily?: IndexRatePoint[];
	/** IPCA mensal (SGS 433), % ao mês. */
	ipcaMonthly?: IndexRatePoint[];
}

export interface FixedIncomeValuation {
	/** Data até onde o valor foi marcado (o vencimento, se já passou). */
	valuedAt: string;
	grossValue: number;
	grossYield: number;
	/** Dias úteis de rendimento entre a aplicação e `valuedAt`. */
	businessDays: number;
	/** Dias corridos, que definem as alíquotas de IR e IOF. */
	calendarDays: number;
	iof: number;
	incomeTax: number;
	incomeTaxRatePct: number;
	netValue: number;
	taxExempt: boolean;
	/**
	 * Dias (CDI) ou meses (IPCA) sem índice publicado em que valeu o último
	 * conhecido. Zero quando a marcação usou só dado publicado.
	 */
	estimatedPeriods: number;
}
