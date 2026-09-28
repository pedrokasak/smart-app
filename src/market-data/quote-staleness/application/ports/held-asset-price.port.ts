import { QuoteFreshnessRecord } from '../../domain/quote-freshness';

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
	/** Devolve quantas posições foram atualizadas. */
	applyLatestPrices(records: QuoteFreshnessRecord[]): Promise<number>;
}

export const HELD_ASSET_PRICE_WRITER = Symbol('HELD_ASSET_PRICE_WRITER');
