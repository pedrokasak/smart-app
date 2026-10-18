import type {
	FixedIncomePosition,
	FixedIncomeValuation,
	IndexSeries,
} from '../../domain/fixed-income.types';

/** Séries de índice (CDI diário, IPCA mensal) entre duas datas. */
export const FIXED_INCOME_INDEX_SERIES = Symbol('FIXED_INCOME_INDEX_SERIES');

export interface IndexSeriesReader {
	load(from: string, to: string): Promise<IndexSeries>;
}

/** Posições `fixed_income` guardadas e a gravação da marcação diária. */
export const FIXED_INCOME_HOLDINGS = Symbol('FIXED_INCOME_HOLDINGS');

export interface FixedIncomeHolding {
	id: string;
	position: FixedIncomePosition;
}

export interface FixedIncomeHoldingsStore {
	listAll(): Promise<FixedIncomeHolding[]>;
	applyValuations(
		items: { id: string; valuation: FixedIncomeValuation }[],
		markedAt: Date
	): Promise<number>;
}

/** Acesso à carteira: dono e inclusão do ativo, pelas regras dela (cota). */
export const FIXED_INCOME_PORTFOLIO_ACCESS = Symbol(
	'FIXED_INCOME_PORTFOLIO_ACCESS'
);

export interface PortfolioAccess {
	assertOwnership(userId: string, portfolioId: string): Promise<void>;
	insertAsset(
		portfolioId: string,
		asset: Record<string, unknown>
	): Promise<unknown>;
}
