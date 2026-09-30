import { QuoteFreshnessRecord } from '../../domain/quote-freshness';

/**
 * Cotação de cripto em BRL (TRA-252). Devolve só os símbolos que a fonte
 * reconhece com certeza: símbolo sem mapeamento fica de fora, nunca é
 * resolvido por aproximação — foi aproximação que transformou LUNC num papel
 * homônimo.
 */
export interface CryptoQuoteSource {
	quote(symbols: string[]): Promise<QuoteFreshnessRecord[]>;
}

export const CRYPTO_QUOTE_SOURCE = Symbol('CRYPTO_QUOTE_SOURCE');
