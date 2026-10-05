import type { InstrumentKind } from './fixed-income-tax';

/**
 * Como a taxa do papel se liga ao mercado:
 *  - `PERCENT_CDI`: `ratePct`% do CDI (CDB, LCI, LCA...);
 *  - `CDI_PLUS`: CDI + `ratePct` ao ano (Tesouro Selic);
 *  - `PREFIXED`: `ratePct` ao ano, travada na compra;
 *  - `IPCA_PLUS`: IPCA + `ratePct` ao ano (juro real).
 */
export type Indexer = 'PERCENT_CDI' | 'CDI_PLUS' | 'PREFIXED' | 'IPCA_PLUS';

export const OFFER_INDEXERS = ['PERCENT_CDI', 'PREFIXED', 'IPCA_PLUS'] as const;
export type OfferIndexer = (typeof OFFER_INDEXERS)[number];

export type InstrumentFamily = 'TESOURO' | 'BANK' | 'REFERENCE';

export interface Instrument {
	id: string;
	/**
	 * Nome canônico, montado pelo server a partir de tipo e taxa. O texto livre
	 * que a pessoa digita fica em `label` e só serve para exibição: nunca chega
	 * ao trackerr-ia nem às frases do veredito.
	 */
	name: string;
	kind: InstrumentKind;
	family: InstrumentFamily;
	indexer: Indexer;
	/** O significado depende do `indexer` (ver acima). */
	ratePct: number;
	label?: string;
	/** YYYY-MM-DD — só os títulos do Tesouro têm. */
	maturityDate?: string;
}
