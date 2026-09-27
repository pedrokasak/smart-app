import axios from 'axios';

/**
 * Leitura de séries diárias do SGS do BACEN respeitando os limites da API
 * (TRA-226), medidos ao vivo e não documentados:
 *
 * - janela maior que 10 anos em série diária responde HTTP 406;
 * - uma janela de uma década leva de 10 a 20s na origem e pode ser cortada
 *   perto dos 30s.
 *
 * Por isso o intervalo é fatiado em janelas de no máximo 3 anos, buscadas com
 * concorrência limitada e fundidas em ordem de data.
 */

export const SGS_MAX_WINDOW_YEARS = 3;
export const SGS_CHUNK_TIMEOUT_MS = 30_000;
export const SGS_MAX_CONCURRENCY = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SgsPoint {
	/** YYYY-MM-DD */
	date: string;
	value: number;
}

export interface DateWindow {
	from: Date;
	to: Date;
}

function startOfUtcDay(date: Date): Date {
	return new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
	);
}

function addUtcYears(date: Date, years: number): Date {
	const next = new Date(date.getTime());
	next.setUTCFullYear(next.getUTCFullYear() + years);
	return next;
}

export function toBacenDate(date: Date): string {
	const day = String(date.getUTCDate()).padStart(2, '0');
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	return `${day}/${month}/${date.getUTCFullYear()}`;
}

/**
 * Divide [from, to] em janelas contíguas e sem sobreposição de no máximo
 * `maxYears` anos: cada janela começa no dia seguinte ao fim da anterior, o
 * que evita datas duplicadas nas emendas já na origem.
 */
export function splitIntoWindows(
	from: Date,
	to: Date,
	maxYears: number = SGS_MAX_WINDOW_YEARS
): DateWindow[] {
	const start = startOfUtcDay(from);
	const end = startOfUtcDay(to);
	if (start.getTime() > end.getTime()) return [];

	const windows: DateWindow[] = [];
	let cursor = start;
	while (cursor.getTime() <= end.getTime()) {
		const windowEnd = new Date(
			addUtcYears(cursor, maxYears).getTime() - DAY_MS
		);
		const clampedEnd = windowEnd.getTime() < end.getTime() ? windowEnd : end;
		windows.push({ from: cursor, to: clampedEnd });
		cursor = new Date(clampedEnd.getTime() + DAY_MS);
	}
	return windows;
}

/** Funde os pedaços em ordem de data, mantendo a primeira ocorrência de cada dia. */
export function mergeSeries(chunks: SgsPoint[][]): SgsPoint[] {
	const byDate = new Map<string, SgsPoint>();
	for (const chunk of chunks) {
		for (const point of chunk) {
			if (!byDate.has(point.date)) byDate.set(point.date, point);
		}
	}
	return Array.from(byDate.values()).sort((a, b) =>
		a.date < b.date ? -1 : a.date > b.date ? 1 : 0
	);
}

export function parseSgsRows(rows: unknown): SgsPoint[] {
	if (!Array.isArray(rows)) return [];
	return rows
		.map((row: any) => {
			const value = Number(String(row?.valor ?? '').replace(',', '.'));
			const [day, month, year] = String(row?.data ?? '').split('/');
			if (!day || !month || !year || !Number.isFinite(value)) return null;
			return { date: `${year}-${month}-${day}`, value };
		})
		.filter((point): point is SgsPoint => point !== null);
}

export class SgsWindowFetchError extends Error {
	constructor(
		readonly seriesCode: number,
		readonly window: DateWindow,
		readonly cause: unknown
	) {
		super(
			`SGS ${seriesCode} falhou na janela ${toBacenDate(window.from)}` +
				`–${toBacenDate(window.to)}: ${(cause as Error)?.message || cause}`
		);
		this.name = 'SgsWindowFetchError';
	}
}

async function fetchWindow(
	seriesCode: number,
	window: DateWindow,
	timeoutMs: number
): Promise<SgsPoint[]> {
	const url =
		`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${seriesCode}/dados?formato=json` +
		`&dataInicial=${toBacenDate(window.from)}` +
		`&dataFinal=${toBacenDate(window.to)}`;
	try {
		const response = await axios.get(url, { timeout: timeoutMs });
		return readSgsBody(response.data);
	} catch (error) {
		if ((error as any)?.response?.status === 404) return [];
		throw new SgsWindowFetchError(seriesCode, window, error);
	}
}

/**
 * Janela sem observação (fim de semana, feriado, dado do dia ainda não
 * publicado) volta como HTTP 200 com `{"erro":{"statusCode":404}}` — é
 * ausência legítima, vira pedaço vazio. Qualquer outro corpo que não seja
 * lista é falha: tratá-lo como vazio devolveria uma série com buraco.
 */
function readSgsBody(body: unknown): SgsPoint[] {
	if (Array.isArray(body)) return parseSgsRows(body);
	const statusCode = (body as any)?.erro?.statusCode;
	if (statusCode === 404) return [];
	throw new Error(
		`resposta inesperada do SGS (${statusCode ?? 'corpo não é lista'})`
	);
}

async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const runners = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			while (next < items.length) {
				const index = next++;
				results[index] = await worker(items[index]);
			}
		}
	);
	await Promise.all(runners);
	return results;
}

/**
 * Busca a série diária completa. Tudo ou nada: se qualquer janela falhar,
 * lança `SgsWindowFetchError` dizendo qual — uma série com buracos daria um
 * Sharpe calculado sobre parte do período sem ninguém perceber.
 */
export async function fetchSgsDailySeries(
	seriesCode: number,
	from: Date,
	to: Date,
	options: {
		timeoutMs?: number;
		concurrency?: number;
		/** Primeira data da série: limita quantas janelas um `from` antigo gera. */
		seriesStart?: Date;
	} = {}
): Promise<SgsPoint[]> {
	const start =
		options.seriesStart && from.getTime() < options.seriesStart.getTime()
			? options.seriesStart
			: from;
	const windows = splitIntoWindows(start, to);
	if (!windows.length) return [];

	const chunks = await mapWithConcurrency(
		windows,
		options.concurrency ?? SGS_MAX_CONCURRENCY,
		(window) =>
			fetchWindow(seriesCode, window, options.timeoutMs ?? SGS_CHUNK_TIMEOUT_MS)
	);
	return mergeSeries(chunks);
}
