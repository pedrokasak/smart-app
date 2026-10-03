import { FiiFiling } from 'src/ri-intelligence/watch/domain/fii-filing';

/**
 * Documentos entregues por um FII (TRA-266). Uma consulta por fundo: a
 * listagem geral da FundosNet nao diz de que CNPJ e cada documento.
 *
 * Lanca quando a fonte nao responde como esperado; o vigia segue com os
 * outros fundos e com as acoes.
 */
export interface FiiFilingFeedPort {
	listFundFilings(cnpj: string, from: Date, to: Date): Promise<FiiFiling[]>;
}

export const FII_FILING_FEED = Symbol('FII_FILING_FEED');
