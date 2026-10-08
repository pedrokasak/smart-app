import type { InvestmentFundClass } from '../../domain/fund-class';
import type { FundQuote } from '../../domain/fund-quote';

/** Arquivo lido de novo; `unchanged` quando o hash bate com a última leitura. */
export type SourceRead<T> =
	| { status: 'parsed'; sourceUrl: string; sha256: string; data: T }
	| { status: 'unchanged'; sourceUrl: string; sha256: string }
	| { status: 'missing'; sourceUrl: string };

export interface DailyReport {
	quotes: FundQuote[];
	rows: number;
	invalidRows: number;
	latestDate: string | null;
}

export interface InvestmentFundDataSource {
	/** Informe Diário de uma competência (`YYYYMM`). */
	fetchDailyReport(
		competence: string,
		knownSha256?: string | null
	): Promise<SourceRead<DailyReport>>;
	/** Registro de classes FIF (com subclasses). */
	fetchRegistry(
		knownSha256?: string | null
	): Promise<SourceRead<InvestmentFundClass[]>>;
}
export const INVESTMENT_FUND_SOURCE = Symbol('INVESTMENT_FUND_SOURCE');

/** Rastro de cada arquivo lido: de onde veio, qual hash, quantas linhas. */
export interface IngestionRecord {
	key: string;
	sourceUrl: string;
	sha256: string;
	rows: number;
	latestDate: string | null;
	ingestedAt: Date;
}

export interface StoredFundQuote extends FundQuote {
	sourceUrl: string;
}

export interface InvestmentFundStore {
	replaceClasses(classes: InvestmentFundClass[]): Promise<number>;
	/** Grava só cota com data igual ou posterior à guardada. */
	upsertLatestQuotes(quotes: FundQuote[], sourceUrl: string): Promise<number>;
	findClass(cnpj: string): Promise<InvestmentFundClass | null>;
	searchClasses(query: string, limit: number): Promise<InvestmentFundClass[]>;
	/** Cotas de classe (sem subclasse) dos CNPJs pedidos. */
	findClassQuotes(cnpjs: string[]): Promise<StoredFundQuote[]>;
	countClasses(): Promise<number>;
	findIngestion(key: string): Promise<IngestionRecord | null>;
	saveIngestion(record: IngestionRecord): Promise<void>;
}
export const INVESTMENT_FUND_STORE = Symbol('INVESTMENT_FUND_STORE');

/** Leva a cota para as posições `investment_fund` (campo `currentPrice`). */
export interface FundHoldingPriceWriter {
	/** CNPJs que alguém tem na carteira como `investment_fund`. */
	heldCnpjs(): Promise<string[]>;
	applyQuotes(quotes: StoredFundQuote[]): Promise<number>;
}
export const FUND_HOLDING_PRICE_WRITER = Symbol('FUND_HOLDING_PRICE_WRITER');
