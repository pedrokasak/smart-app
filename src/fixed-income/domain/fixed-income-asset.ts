import type {
	FixedIncomePosition,
	FixedIncomeValuation,
} from './fixed-income.types';

/**
 * Tipo de posição para renda fixa cadastrada pela pessoa (TRA-230).
 *
 * Diferente de `fund`, onde a importação da B3 grava LCA hoje, e de
 * `investment_fund` (fundo aberto, TRA-276). A posição fica com
 * `quantity = 1`, `price = principal` e o valor marcado na curva em
 * `currentPrice`/`total`: assim alocação, histórico, IA e relatórios, que
 * leem esses campos, enxergam o valor certo sem saber o que é renda fixa.
 */
export const FIXED_INCOME_ASSET_TYPE = 'fixed_income' as const;

export const CURVE_PRICE_SOURCE = 'curve';

/** Subdocumento `fixedIncome` do ativo. */
export interface FixedIncomeAssetData extends FixedIncomePosition {
	/** Última marcação; `null` até a primeira (falta de série, por exemplo). */
	valuation?: FixedIncomeValuation | null;
}
