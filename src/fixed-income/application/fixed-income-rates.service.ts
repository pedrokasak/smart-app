import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { compoundPercent } from 'src/macro-indicators/domain/compounding';
import {
	MacroSeriesService,
	todayInSaoPaulo,
} from 'src/macro-indicators/application/macro-series.service';
import type { MacroSeriesKey } from 'src/macro-indicators/domain/series-catalog';
import { TtlPromiseCache } from 'src/macro-indicators/infrastructure/bcb-sgs/ttl-promise-cache';
import { addDays, daysBetween } from '../domain/dates';
import { annualFromDailyPct } from '../domain/rate-math';
import type { TesouroTitle } from '../domain/tesouro-title';
import { FIXED_INCOME_CLOCK } from './fixed-income-clock';
import { TesouroOffersService } from './tesouro-offers.service';

/** Leitura de mercado com a data a que se refere e de onde veio. */
export interface MarketRate {
	valuePct: number;
	/** YYYY-MM-DD (no IPCA, o primeiro dia do mês de referência). */
	asOf: string;
	source: string;
	/** Passou do prazo em que o valor ainda conta como "de hoje". */
	stale: boolean;
}

export interface FixedIncomeRates {
	/** CDI anual efetivo (base 252), a partir do CDI diário do BACEN. */
	cdi: MarketRate | null;
	selicMeta: MarketRate | null;
	/** IPCA acumulado nos últimos 12 meses publicados. */
	ipca12m: MarketRate | null;
	tesouro: {
		baseDate: string;
		fetchedAt: string;
		stale: boolean;
		sourceUrl: string;
		titles: TesouroTitle[];
	} | null;
}

const MONTHS_IN_YEAR = 12;

/**
 * A tela pede taxas, cálculo e veredito em sequência, e cada um relê tudo.
 * CDI, IPCA e Tesouro mudam no máximo uma vez por dia: meio minuto de reuso
 * corta as idas ao banco sem deixar a taxa velha de verdade.
 */
const RATES_CACHE_TTL_MS = 30_000;
/** Folga para o CDI (dia útil), a Selic meta (muda a cada reunião) e o IPCA (publicado ~dia 10 do mês seguinte). */
const STALE_AFTER_DAYS: Record<'CDI' | 'SELIC_META' | 'IPCA', number> = {
	CDI: 7,
	SELIC_META: 14,
	IPCA: 100,
};

const monthIndex = (isoDate: string) => {
	const [year, month] = isoDate.split('-').map(Number);
	return year * MONTHS_IN_YEAR + (month - 1);
};

/**
 * Taxas que o comparador usa como ponto de partida: CDI, Selic meta e IPCA do
 * BACEN (módulo macro-indicators) e os títulos do Tesouro Direto (Tesouro
 * Transparente). Cada leitura falha sozinha — o que não vier é devolvido como
 * `null`, nunca como um número no lugar.
 */
@Injectable()
export class FixedIncomeRatesService {
	private readonly logger = new Logger(FixedIncomeRatesService.name);
	private readonly cache: TtlPromiseCache<FixedIncomeRates>;

	constructor(
		private readonly macroSeries: MacroSeriesService,
		private readonly tesouroOffers: TesouroOffersService,
		@Optional()
		@Inject(FIXED_INCOME_CLOCK)
		private readonly clock?: () => Date
	) {
		this.cache = new TtlPromiseCache<FixedIncomeRates>(
			RATES_CACHE_TTL_MS,
			1,
			() => this.now().getTime()
		);
	}

	private now(): Date {
		return this.clock ? this.clock() : new Date();
	}

	getRates(): Promise<FixedIncomeRates> {
		return this.cache.getOrLoad('rates', () => this.load());
	}

	private async load(): Promise<FixedIncomeRates> {
		const today = todayInSaoPaulo(this.now());
		const [cdi, selicMeta, ipca12m, tesouro] = await Promise.all([
			this.guarded('CDI', () => this.readCdi(today)),
			this.guarded('Selic meta', () => this.readSelicMeta(today)),
			this.guarded('IPCA', () => this.readIpca12m(today)),
			this.guarded('Tesouro', () => this.readTesouro()),
		]);
		return { cdi, selicMeta, ipca12m, tesouro };
	}

	private async guarded<T>(label: string, read: () => Promise<T | null>) {
		try {
			return await read();
		} catch (error) {
			this.logger.warn(
				`Leitura de ${label} falhou: ${(error as Error)?.message || error}`
			);
			return null;
		}
	}

	private async lastPoints(key: MacroSeriesKey, from: string, to: string) {
		const result = await this.macroSeries.getSeries(key, from, to);
		return {
			points: result.points,
			source: `${result.descriptor.source}_${result.descriptor.code}`,
		};
	}

	private async readCdi(today: string): Promise<MarketRate | null> {
		const { points, source } = await this.lastPoints(
			'CDI',
			addDays(today, -20),
			today
		);
		const last = points.at(-1);
		if (!last) return null;
		return {
			valuePct: annualFromDailyPct(last.value),
			asOf: last.date,
			source,
			stale: daysBetween(last.date, today) > STALE_AFTER_DAYS.CDI,
		};
	}

	private async readSelicMeta(today: string): Promise<MarketRate | null> {
		const { points, source } = await this.lastPoints(
			'SELIC_META',
			addDays(today, -120),
			today
		);
		const last = points.at(-1);
		if (!last) return null;
		return {
			valuePct: last.value,
			asOf: last.date,
			source,
			stale: daysBetween(last.date, today) > STALE_AFTER_DAYS.SELIC_META,
		};
	}

	private async readIpca12m(today: string): Promise<MarketRate | null> {
		const { points, source } = await this.lastPoints(
			'IPCA',
			addDays(today, -430),
			today
		);
		const window = points.slice(-MONTHS_IN_YEAR);
		if (window.length < MONTHS_IN_YEAR) return null;

		// Um mês faltando no meio emendaria 12 pontos que não são 12 meses.
		const consecutive =
			monthIndex(window[window.length - 1].date) -
				monthIndex(window[0].date) ===
			MONTHS_IN_YEAR - 1;
		if (!consecutive) return null;

		const asOf = window[window.length - 1].date;
		return {
			valuePct: compoundPercent(window.map((point) => point.value)),
			asOf,
			source,
			stale: daysBetween(asOf, today) > STALE_AFTER_DAYS.IPCA,
		};
	}

	private async readTesouro(): Promise<FixedIncomeRates['tesouro']> {
		const offers = await this.tesouroOffers.getOffers();
		if (!offers) return null;
		return {
			baseDate: offers.baseDate,
			fetchedAt: offers.fetchedAt.toISOString(),
			stale: offers.stale,
			sourceUrl: offers.sourceUrl,
			titles: offers.titles,
		};
	}
}
