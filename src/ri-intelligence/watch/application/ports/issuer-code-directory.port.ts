/**
 * Codigo CVM do emissor de um ticker (TRA-260). A consulta diaria do ENET
 * identifica a companhia so pelo codigo CVM; e ele que liga uma entrega aos
 * tickers em carteira.
 */
export interface IssuerCodeDirectory {
	/** Codigo normalizado (`normalizeCvmCode`), ou null se desconhecido. */
	resolveCvmCode(ticker: string): Promise<string | null>;
}

export const ISSUER_CODE_DIRECTORY = Symbol('ISSUER_CODE_DIRECTORY');
