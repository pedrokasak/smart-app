import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
	MACRO_SERIES_KEYS,
	type MacroSeriesKey,
	SERIES_CATALOG,
	type SeriesDescriptor,
	sgsSourceUrl,
} from '../domain/series-catalog';
import {
	MACRO_SERIES_REPOSITORY,
	MACRO_SERIES_SOURCE,
	type MacroSeriesPoint,
	type MacroSeriesRepository,
	type MacroSeriesSource,
} from './macro-series.ports';

/** Relógio injetável, para teste. Sem provider, vale a hora do sistema. */
export const MACRO_CLOCK = Symbol('MACRO_CLOCK');

/**
 * Janela que toda sincronização relê para trás do último ponto guardado.
 * Cobre revisão de valor na origem e garante que o IPCA do mês anterior,
 * divulgado por volta do dia 10, entre mesmo que o job tenha falhado alguns
 * dias seguidos.
 */
const RESYNC_LOOKBACK_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface MacroSeriesResult {
	descriptor: SeriesDescriptor;
	points: MacroSeriesPoint[];
	/** Instante da última leitura na origem; `null` se nunca foi carregada. */
	extractedAt: Date | null;
	/** URL que reproduz a consulta no BACEN. */
	sourceUrl: string;
}

/** Data de hoje no fuso do BACEN, em YYYY-MM-DD. */
export function todayInSaoPaulo(now: Date): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Sao_Paulo',
	}).format(now);
}

function shiftDays(isoDate: string, days: number): string {
	const time = new Date(`${isoDate}T00:00:00.000Z`).getTime() + days * DAY_MS;
	return new Date(time).toISOString().slice(0, 10);
}

/**
 * Séries macro servidas do banco (TRA-227). O BACEN só é chamado pelo job de
 * sincronização — e, uma única vez, quando a série ainda nunca foi carregada.
 * Assim a origem sai do caminho de cada requisição e uma falha dela aparece
 * no log do job, em vez de virar série vazia calada na tela.
 */
@Injectable()
export class MacroSeriesService {
	private readonly logger = new Logger(MacroSeriesService.name);
	private readonly inFlightSyncs = new Map<MacroSeriesKey, Promise<number>>();

	constructor(
		@Inject(MACRO_SERIES_REPOSITORY)
		private readonly repository: MacroSeriesRepository,
		@Inject(MACRO_SERIES_SOURCE)
		private readonly source: MacroSeriesSource,
		@Optional()
		@Inject(MACRO_CLOCK)
		private readonly clock?: () => Date
	) {}

	private now(): Date {
		return this.clock ? this.clock() : new Date();
	}

	async getSeries(
		key: MacroSeriesKey,
		from: string,
		to: string
	): Promise<MacroSeriesResult> {
		const descriptor = SERIES_CATALOG[key];
		let last = await this.repository.lastPoint(descriptor.code);
		if (!last) {
			// Série nunca carregada (deploy novo, antes do primeiro job). Se a
			// origem também falhar, a resposta sai vazia com `extractedAt: null`
			// — quem consome declara a lacuna em vez de quebrar.
			try {
				await this.sync(key);
				last = await this.repository.lastPoint(descriptor.code);
			} catch (error) {
				this.logger.warn(
					`Carga inicial de ${key} falhou: ${(error as Error)?.message || error}`
				);
			}
		}

		const points =
			from <= to
				? await this.repository.findRange(descriptor.code, from, to)
				: [];
		return {
			descriptor,
			points,
			extractedAt: last?.fetchedAt ?? null,
			sourceUrl: sgsSourceUrl(descriptor, from, to),
		};
	}

	/**
	 * Traz da origem o que falta e grava. Chamadas simultâneas para a mesma
	 * série compartilham a mesma sincronização. Devolve quantos pontos gravou.
	 */
	sync(key: MacroSeriesKey): Promise<number> {
		const running = this.inFlightSyncs.get(key);
		if (running) return running;

		const task = this.runSync(SERIES_CATALOG[key]).finally(() =>
			this.inFlightSyncs.delete(key)
		);
		this.inFlightSyncs.set(key, task);
		return task;
	}

	/** Uma série com falha não impede as outras. */
	async syncAll(): Promise<Record<MacroSeriesKey, number | 'failed'>> {
		const result = {} as Record<MacroSeriesKey, number | 'failed'>;
		for (const key of MACRO_SERIES_KEYS) {
			try {
				result[key] = await this.sync(key);
			} catch (error) {
				result[key] = 'failed';
				this.logger.error(
					`Sincronização de ${key} falhou: ${(error as Error)?.message || error}`
				);
			}
		}
		return result;
	}

	private async runSync(descriptor: SeriesDescriptor): Promise<number> {
		const now = this.now();
		const today = todayInSaoPaulo(now);
		const last = await this.repository.lastPoint(descriptor.code);

		let from = descriptor.backfillFrom;
		if (last) {
			const lookback = shiftDays(today, -RESYNC_LOOKBACK_DAYS);
			from = last.date < lookback ? last.date : lookback;
		}
		if (from > today) return 0;

		const points = await this.source.fetch(descriptor, from, today);
		if (!points.length) return 0;
		return this.repository.upsertMany(descriptor.code, points, now);
	}
}
