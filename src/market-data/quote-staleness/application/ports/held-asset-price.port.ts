import { QuoteFreshnessRecord } from '../../domain/quote-freshness';
import { QuoteKind } from '../../domain/quote-kind';

/**
 * Leva a última cotação lida para as posições de quem tem o símbolo
 * (TRA-247).
 *
 * `Asset.currentPrice` só era gravado quando a posição era adicionada. O
 * snapshot diário do histórico, os relatórios e a IA leem esse campo, então
 * tudo ficava parado no preço do dia da importação. A varredura já lê a
 * cotação de todo símbolo em carteira; esta porta grava essa leitura nas
 * posições.
 */
export interface HeldAssetPriceWriter {
	/**
	 * Grava as leituras nas posições do tipo que aquela fonte cota — cotação
	 * de ação nunca chega à cripto (TRA-252). Devolve quantas foram
	 * atualizadas.
	 */
	applyLatestPrices(
		records: QuoteFreshnessRecord[],
		kind: QuoteKind
	): Promise<number>;

	/**
	 * Desfaz o preço que a cadeia de ações gravou em cripto sem cotação na
	 * CoinGecko (TRA-252). Devolve quantas posições foram limpas.
	 */
	clearMisquotedCrypto(pricedSymbols: string[]): Promise<number>;
}

export const HELD_ASSET_PRICE_WRITER = Symbol('HELD_ASSET_PRICE_WRITER');
