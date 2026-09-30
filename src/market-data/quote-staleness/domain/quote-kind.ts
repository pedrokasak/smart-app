/**
 * Quem cota cada tipo de posição (TRA-252).
 *
 * A varredura tratava todo símbolo como ação: "LUNC" (Terra Classic) caía
 * num papel homônimo cotado a R$ 24,90, e a gravação nas posições (TRA-247)
 * levava esse preço para a cripto — 1.092 LUNC viravam R$ 27 mil. Ação, FII
 * e ETF são cotados pela cadeia de mercado; cripto só pela fonte de cripto;
 * renda fixa e "outros" não têm cotação.
 */
export const MARKET_QUOTE_TYPES = ['stock', 'fii', 'etf'] as const;
export const CRYPTO_QUOTE_TYPES = ['crypto'] as const;

export type QuoteKind = 'market' | 'crypto';

export function assetTypesFor(kind: QuoteKind): readonly string[] {
	return kind === 'crypto' ? CRYPTO_QUOTE_TYPES : MARKET_QUOTE_TYPES;
}
