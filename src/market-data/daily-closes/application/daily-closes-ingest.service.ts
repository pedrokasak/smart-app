import { Inject, Injectable, Logger } from '@nestjs/common';
import { CotahistQuote, parseCotahist } from '../domain/cotahist-parser';
import { brasiliaDate, lastWeekdays, yearOf } from '../domain/trading-days';
import { DAILY_CLOSES_CONFIG, DailyClosesConfig } from './daily-closes.config';
import {
	COTAHIST_SOURCE,
	CotahistSource,
	DAILY_CLOSE_STORE,
	DailyCloseStore,
	HELD_SYMBOLS_READER,
	HeldSymbol,
	HeldSymbolsReader,
} from './ports';

export interface IngestReport {
	days: { date: string; published: boolean; stored: number }[];
	years: { year: number; symbols: number; stored: number }[];
}

const BATCH_SIZE = 2000;
/** Depois disso o ano corrente é baixado de novo, para fechar buracos. */
const CURRENT_YEAR_REFRESH_DAYS = 14;

/**
 * Alimenta `daily_closes` com o COTAHIST da B3 (TRA-251).
 *
 * Só guarda o que alguém carrega em carteira (mais o ativo usado como mercado
 * no beta): o arquivo anual tem mais de um milhão de linhas por ano.
 *
 * Duas frentes:
 *  - dia a dia: os últimos pregões que ainda não estão no banco. Cobre atraso
 *    de publicação e uma noite em que o job não rodou.
 *  - histórico: o arquivo anual para quem tem negociação antiga, uma vez por
 *    (símbolo, ano). Os mais recentes primeiro, poucos por rodada.
 */
@Injectable()
export class DailyClosesIngestService {
	private readonly logger = new Logger(DailyClosesIngestService.name);

	constructor(
		@Inject(DAILY_CLOSE_STORE) private readonly store: DailyCloseStore,
		@Inject(COTAHIST_SOURCE) private readonly source: CotahistSource,
		@Inject(HELD_SYMBOLS_READER) private readonly held: HeldSymbolsReader,
		@Inject(DAILY_CLOSES_CONFIG) private readonly config: DailyClosesConfig
	) {}

	async run(now: Date = new Date()): Promise<IngestReport> {
		const held = await this.withMarketProxy(await this.held.list(), now);
		const symbols = new Set(held.map((item) => item.symbol));
		return {
			days: await this.catchUpDays(symbols, now),
			years: await this.backfillYears(held, now),
		};
	}

	/** O ativo de mercado entra sempre, com histórico até onde a carteira vai. */
	private withMarketProxy(held: HeldSymbol[], now: Date): HeldSymbol[] {
		const proxy = this.config.marketProxy;
		const rest = held.filter((item) => item.symbol !== proxy);
		const oldest = rest
			.map((item) => item.since)
			.filter((since): since is Date => since instanceof Date)
			.reduce<Date | null>(
				(min, since) => (!min || since < min ? since : min),
				null
			);
		const fallback = new Date(now);
		fallback.setUTCFullYear(fallback.getUTCFullYear() - 1);
		return [...rest, { symbol: proxy, since: oldest ?? fallback }];
	}

	private async catchUpDays(
		symbols: ReadonlySet<string>,
		now: Date
	): Promise<IngestReport['days']> {
		const report: IngestReport['days'] = [];
		for (const date of lastWeekdays(now, this.config.catchUpDays)) {
			if (await this.store.hasDate(date)) continue;

			const lines = await this.source.fetchDay(date);
			if (!lines) {
				report.push({ date, published: false, stored: 0 });
				continue;
			}
			const stored = await this.ingest(lines, symbols);
			report.push({ date, published: true, stored });
		}
		return report;
	}

	private async backfillYears(
		held: HeldSymbol[],
		now: Date
	): Promise<IngestReport['years']> {
		const currentYear = yearOf(brasiliaDate(now));
		const oldestYear = currentYear - this.config.backfillYears;
		const staleBefore = new Date(now);
		staleBefore.setUTCDate(
			staleBefore.getUTCDate() - CURRENT_YEAR_REFRESH_DAYS
		);
		const covered = await this.store.coveredYears(
			held.map((item) => item.symbol),
			currentYear,
			staleBefore
		);

		const pending = new Map<number, string[]>();
		for (const { symbol, since } of held) {
			const firstYear = Math.max(
				oldestYear,
				since ? since.getUTCFullYear() : currentYear
			);
			for (let year = firstYear; year <= currentYear; year += 1) {
				if (covered.get(symbol)?.has(year)) continue;
				pending.set(year, [...(pending.get(year) ?? []), symbol]);
			}
		}

		const report: IngestReport['years'] = [];
		const years = [...pending.keys()]
			.sort((a, b) => b - a)
			.slice(0, this.config.maxYearsPerRun);
		for (const year of years) {
			const symbols = pending.get(year)!;
			// Sem arquivo (ano corrente ainda sem publicação, por exemplo) não
			// marca cobertura: tenta de novo na próxima rodada.
			const lines = await this.source.fetchYear(year);
			if (!lines) continue;

			const stored = await this.ingest(lines, new Set(symbols));
			await this.store.markCovered(symbols, year);
			report.push({ year, symbols: symbols.length, stored });
		}
		return report;
	}

	private async ingest(
		lines: AsyncIterable<string>,
		symbols: ReadonlySet<string>
	): Promise<number> {
		let batch: CotahistQuote[] = [];
		let stored = 0;
		for await (const quote of parseCotahist(lines, symbols)) {
			batch.push(quote);
			if (batch.length >= BATCH_SIZE) {
				stored += await this.store.upsertMany(batch);
				batch = [];
			}
		}
		if (batch.length) stored += await this.store.upsertMany(batch);
		this.logger.log(`COTAHIST: ${stored} cotações gravadas`);
		return stored;
	}
}
