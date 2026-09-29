/**
 * Quem esta em carteira (TRA-240). O vigia so gasta descoberta e IA com
 * papel que alguem carrega — mesmo principio do frescor de cotacao.
 */
export interface HeldTickerDirectory {
	/**
	 * Tickers de ACAO com quantidade positiva em alguma carteira. FII fica de
	 * fora por enquanto: o IPE da CVM cobre companhias abertas, e a descoberta
	 * de FII que existe raspa sites de terceiros — impropria para rotina
	 * automatica. Entra com fonte oficial (Fundos.NET) em outra etapa.
	 */
	heldStockTickers(): Promise<string[]>;
}

export const HELD_TICKER_DIRECTORY = Symbol('HELD_TICKER_DIRECTORY');
