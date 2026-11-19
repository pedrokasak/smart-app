import { AssetClass } from '../../domain/enums';

export interface DailyCloseMinor {
	/** YYYY-MM-DD */
	date: string;
	closeMinor: number;
}

export interface PriceHistoryPort {
	/** Fechamentos em centavos entre from e to (inclusive). [] quando a fonte não tem o ativo. Nunca lança. */
	getDailyCloses(
		symbol: string,
		assetClass: AssetClass,
		from: string,
		to: string
	): Promise<DailyCloseMinor[]>;
}
