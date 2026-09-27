/**
 * Catálogo das séries macro que o Trackerr lê do BACEN (TRA-227).
 *
 * A pergunta que evita a maior parte dos erros com essas séries é "isto é
 * nível ou taxa?":
 *
 * - `RATE` — cada ponto já é uma variação do período (IPCA mensal, CDI
 *   diário). Acumula por encadeamento, nunca por soma nem média.
 * - `LEVEL` — cada ponto é um valor em si (Selic meta em % a.a., dólar).
 *   Admite comparação entre as pontas; encadear não faz sentido.
 */

export type SeriesKind = 'RATE' | 'LEVEL';
export type SeriesPeriodicity = 'daily' | 'monthly';

export const MACRO_SERIES_KEYS = ['CDI', 'IPCA', 'SELIC_META'] as const;
export type MacroSeriesKey = (typeof MACRO_SERIES_KEYS)[number];

export interface SeriesDescriptor {
	key: MacroSeriesKey;
	/** Código no SGS. */
	code: number;
	label: string;
	kind: SeriesKind;
	periodicity: SeriesPeriodicity;
	unit: 'percent_per_day' | 'percent_per_month' | 'percent_per_year';
	/** Primeira observação publicada, conferida ao vivo. */
	seriesStart: string;
	/**
	 * Até onde o job diário preenche o histórico na primeira carga. Mais antigo
	 * que isso não aparece em nenhuma tela e só custaria requisições.
	 */
	backfillFrom: string;
	source: 'BACEN_SGS';
	license: 'ODbL-1.0';
}

export const SERIES_CATALOG: Record<MacroSeriesKey, SeriesDescriptor> = {
	CDI: {
		key: 'CDI',
		code: 12,
		label: 'CDI',
		kind: 'RATE',
		periodicity: 'daily',
		unit: 'percent_per_day',
		seriesStart: '1986-03-06',
		backfillFrom: '2000-01-01',
		source: 'BACEN_SGS',
		license: 'ODbL-1.0',
	},
	IPCA: {
		key: 'IPCA',
		code: 433,
		label: 'IPCA',
		kind: 'RATE',
		periodicity: 'monthly',
		unit: 'percent_per_month',
		seriesStart: '1980-01-01',
		backfillFrom: '2000-01-01',
		source: 'BACEN_SGS',
		license: 'ODbL-1.0',
	},
	SELIC_META: {
		key: 'SELIC_META',
		code: 432,
		label: 'Selic meta',
		kind: 'LEVEL',
		periodicity: 'daily',
		unit: 'percent_per_year',
		seriesStart: '1999-03-05',
		backfillFrom: '2000-01-01',
		source: 'BACEN_SGS',
		license: 'ODbL-1.0',
	},
};

export function isMacroSeriesKey(value: string): value is MacroSeriesKey {
	return (MACRO_SERIES_KEYS as readonly string[]).includes(value);
}

/** URL que reproduz a consulta na origem — parte da procedência do número. */
export function sgsSourceUrl(
	descriptor: SeriesDescriptor,
	from: string,
	to: string
): string {
	const toBr = (iso: string) => iso.split('-').reverse().join('/');
	return (
		`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${descriptor.code}` +
		`/dados?formato=json&dataInicial=${toBr(from)}&dataFinal=${toBr(to)}`
	);
}
