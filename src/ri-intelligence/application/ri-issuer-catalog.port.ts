export const RI_ISSUER_CATALOG = Symbol('RI_ISSUER_CATALOG');

export interface RiIssuerRef {
	ticker: string;
	company: string;
	cnpj: string;
}

/**
 * Resolve um ticker B3 para a referência do emissor na CVM (CNPJ). A CVM
 * indexa companhias abertas por CNPJ — sem ele, não há como filtrar os
 * datasets de documentos (DFP/IPE). Apenas a cotação individual de ações
 * (Brapi) expõe o CNPJ (`stock.cnpj`); a lista de autocomplete não traz.
 */
export interface RiIssuerCatalogPort {
	resolveByTicker(ticker: string): Promise<RiIssuerRef | null>;
}
