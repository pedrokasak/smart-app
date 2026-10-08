/**
 * Tipo de posição para fundo aberto (TRA-276). É diferente de `fund`, que na
 * carteira é renda fixa (a importação da B3 grava LCA nele). O símbolo da
 * posição é o CNPJ da classe, só dígitos.
 */
export const INVESTMENT_FUND_ASSET_TYPE = 'investment_fund' as const;
