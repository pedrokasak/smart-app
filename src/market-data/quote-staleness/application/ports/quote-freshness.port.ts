import { QuoteFreshnessRecord } from '../../domain/quote-freshness';

/**
 * Persistencia do carimbo de leitura por simbolo (TRA-136, fase 7).
 *
 * Porta, e nao model injetado, pelo mesmo motivo do `ThresholdStateStore`:
 * com ela atras de uma interface, o produtor e a varredura rodam em teste
 * unitario com um Map em memoria, e trocar Mongo por qualquer outro
 * armazenamento (Redis com TTL, por exemplo — o dado e regeneravel) nao
 * encosta em caso de uso.
 */
export interface QuoteFreshnessStore {
	/**
	 * Grava o instante de leituras BEM-SUCEDIDAS. Chamado so depois de a
	 * fonte responder com preco — nunca no caminho de erro, porque e
	 * justamente a ausencia de escrita que faz o relogio andar.
	 */
	recordReads(records: QuoteFreshnessRecord[]): Promise<void>;

	/** Registros dos simbolos pedidos. Simbolo sem registro sai da lista. */
	findBySymbols(symbols: string[]): Promise<QuoteFreshnessRecord[]>;
}

export const QUOTE_FRESHNESS_STORE = Symbol('QUOTE_FRESHNESS_STORE');
