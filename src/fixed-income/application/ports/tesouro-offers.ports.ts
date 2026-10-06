import type { TesouroTitle } from '../../domain/tesouro-title';

/** Títulos à venda no último pregão que a fonte publicou. */
export interface TesouroOffersSnapshot {
	/** Pregão a que as taxas se referem (YYYY-MM-DD). */
	baseDate: string;
	titles: TesouroTitle[];
	/** URL de onde o arquivo foi lido — parte da procedência do número. */
	sourceUrl: string;
}

export interface StoredTesouroOffers extends TesouroOffersSnapshot {
	/** Quando o Trackerr leu a fonte (não confundir com `baseDate`). */
	fetchedAt: Date;
}

/** De onde as ofertas vêm. Hoje, o CSV do Tesouro Transparente. */
export const TESOURO_OFFERS_SOURCE = Symbol('TESOURO_OFFERS_SOURCE');

export interface TesouroOffersSource {
	fetchLatest(): Promise<TesouroOffersSnapshot>;
}

/** Onde o último pregão fica guardado entre duas leituras da fonte. */
export const TESOURO_OFFERS_STORE = Symbol('TESOURO_OFFERS_STORE');

export interface TesouroOffersStore {
	load(): Promise<StoredTesouroOffers | null>;
	/** Substitui o pregão guardado: só o mais recente interessa. */
	save(snapshot: TesouroOffersSnapshot, fetchedAt: Date): Promise<void>;
}
