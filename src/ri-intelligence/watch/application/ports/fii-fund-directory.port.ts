/**
 * CNPJ do fundo de um ticker de FII (TRA-266). A FundosNet lista documento
 * por CNPJ, nunca por ticker: e ele que liga o fundo ao FII em carteira.
 */
export interface FiiFundDirectory {
	/**
	 * CNPJ so com digitos (14), ou null se o fundo nao e conhecido. Lanca
	 * quando a fonte do cadastro esta fora: o vigia pula os FIIs na rodada.
	 */
	resolveFundCnpj(ticker: string): Promise<string | null>;
}

export const FII_FUND_DIRECTORY = Symbol('FII_FUND_DIRECTORY');
