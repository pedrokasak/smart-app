import { CotahistQuote } from '../domain/cotahist-parser';

export interface StoredClose {
	date: string;
	close: number;
}

/** Fechamentos diários guardados (coleção `daily_closes`). */
export interface DailyCloseStore {
	/** Idempotente: o mesmo (símbolo, dia) regravado não duplica. */
	upsertMany(quotes: CotahistQuote[]): Promise<number>;
	/** Em ordem crescente de data, de `from` (inclusive) em diante. */
	find(symbol: string, from: string): Promise<StoredClose[]>;
	hasDate(date: string): Promise<boolean>;
	count(): Promise<number>;
	latestDate(): Promise<string | null>;
	/**
	 * (símbolo, ano) em que já se tentou o arquivo anual. Cobertura do ano
	 * `currentYear` gravada antes de `staleBefore` não conta: o job diário só
	 * conserta os últimos dias, então uma parada longa deixaria um buraco
	 * permanente se o ano corrente ficasse "coberto" para sempre.
	 */
	coveredYears(
		symbols: string[],
		currentYear: number,
		staleBefore: Date
	): Promise<Map<string, Set<number>>>;
	markCovered(symbols: string[], year: number): Promise<void>;
}
export const DAILY_CLOSE_STORE = Symbol('DAILY_CLOSE_STORE');

/**
 * Origem dos arquivos da B3. Devolve `null` quando o arquivo não existe
 * (feriado, fim de semana, ainda não publicado): isso não é erro.
 */
export interface CotahistSource {
	fetchDay(date: string): Promise<AsyncIterable<string> | null>;
	fetchYear(year: number): Promise<AsyncIterable<string> | null>;
}
export const COTAHIST_SOURCE = Symbol('COTAHIST_SOURCE');

export interface HeldSymbol {
	symbol: string;
	/** Data da negociação mais antiga conhecida; `null` se só há posição. */
	since: Date | null;
}

/** Símbolos que alguém carrega, com desde quando precisam de histórico. */
export interface HeldSymbolsReader {
	list(): Promise<HeldSymbol[]>;
}
export const HELD_SYMBOLS_READER = Symbol('HELD_SYMBOLS_READER');

export interface AssetBetaWrite {
	symbol: string;
	beta: number | null;
	asOf: string | null;
	benchmark: string;
}

export interface AssetBetaWriter {
	write(betas: AssetBetaWrite[]): Promise<number>;
}
export const ASSET_BETA_WRITER = Symbol('ASSET_BETA_WRITER');
