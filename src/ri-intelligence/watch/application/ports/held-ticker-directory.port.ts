/**
 * Quem esta em carteira (TRA-240). O vigia so gasta descoberta e IA com
 * papel que alguem carrega — mesmo principio do frescor de cotacao.
 */
export interface HeldTickerDirectory {
	/**
	 * Tickers de ACAO com quantidade positiva em alguma carteira: os que o
	 * IPE e a consulta do ENET (companhias abertas) cobrem.
	 */
	heldStockTickers(): Promise<string[]>;

	/**
	 * Tickers de FII com quantidade positiva em alguma carteira (TRA-266):
	 * os que a FundosNet da B3 cobre. A descoberta de FII que ja existia
	 * raspa sites de terceiros — impropria para rotina automatica.
	 */
	heldFiiTickers(): Promise<string[]>;
}

export const HELD_TICKER_DIRECTORY = Symbol('HELD_TICKER_DIRECTORY');
