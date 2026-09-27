import type { SeriesDescriptor } from '../domain/series-catalog';

export interface MacroSeriesPoint {
	/** YYYY-MM-DD */
	date: string;
	value: number;
}

/** Onde a série fica guardada entre uma sincronização e outra. */
export const MACRO_SERIES_REPOSITORY = Symbol('MACRO_SERIES_REPOSITORY');

export interface MacroSeriesRepository {
	/** Pontos entre `from` e `to` (inclusive), em ordem de data. */
	findRange(
		code: number,
		from: string,
		to: string
	): Promise<MacroSeriesPoint[]>;
	/** Data do último ponto guardado, ou `null` se a série nunca foi carregada. */
	lastPoint(code: number): Promise<{ date: string; fetchedAt: Date } | null>;
	/** Idempotente: reescrever o mesmo dia só atualiza valor e `fetchedAt`. */
	upsertMany(
		code: number,
		points: MacroSeriesPoint[],
		fetchedAt: Date
	): Promise<number>;
}

/** De onde a série vem. Hoje, o SGS do BACEN. */
export const MACRO_SERIES_SOURCE = Symbol('MACRO_SERIES_SOURCE');

export interface MacroSeriesSource {
	fetch(
		descriptor: SeriesDescriptor,
		from: string,
		to: string
	): Promise<MacroSeriesPoint[]>;
}
