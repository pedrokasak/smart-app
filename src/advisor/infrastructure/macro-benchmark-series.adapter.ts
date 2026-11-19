import { Inject, Injectable, Logger } from '@nestjs/common';
import { MacroSeriesService } from 'src/macro-indicators/application/macro-series.service';
import {
	MARKET_DATA_PROVIDER,
	type MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import {
	BenchmarkKey,
	BenchmarkSeriesPort,
} from '../application/ports/benchmark-series.port';
import { selectProviderRange } from './market-price-history.adapter';

const IBOV_SYMBOL = '^BVSP';

/** Retorno acumulado de benchmarks: CDI e IPCA do BACEN, IBOV do provider. */
@Injectable()
export class MacroBenchmarkSeriesAdapter implements BenchmarkSeriesPort {
	private readonly logger = new Logger(MacroBenchmarkSeriesAdapter.name);

	constructor(
		private readonly macroSeries: MacroSeriesService,
		@Inject(MARKET_DATA_PROVIDER)
		private readonly market: MarketDataProviderPort
	) {}

	async periodReturn(
		key: BenchmarkKey,
		from: string,
		to: string
	): Promise<number | null> {
		try {
			if (key === 'IBOV') return await this.ibovReturn(from, to);
			return await this.compoundedReturn(key, from, to);
		} catch (error) {
			this.logger.warn(
				`Benchmark ${key} indisponível: ${
					error instanceof Error ? error.message : 'unknown_error'
				}`
			);
			return null;
		}
	}

	/** CDI (% ao dia) e IPCA (% ao mês): produto de (1 + v/100) menos 1. */
	private async compoundedReturn(
		key: 'CDI' | 'IPCA',
		from: string,
		to: string
	): Promise<number | null> {
		const { points } = await this.macroSeries.getSeries(key, from, to);
		const inWindow = points.filter(
			(point) =>
				point.date >= from && point.date <= to && Number.isFinite(point.value)
		);
		if (!inWindow.length) return null;
		const factor = inWindow.reduce(
			(acc, point) => acc * (1 + point.value / 100),
			1
		);
		return factor - 1;
	}

	private async ibovReturn(from: string, to: string): Promise<number | null> {
		const today = new Date().toISOString().slice(0, 10);
		const closes = await this.market.getDailyCloses(
			IBOV_SYMBOL,
			selectProviderRange(from, today)
		);
		const window = closes.filter(
			(point) =>
				point.date >= from &&
				point.date <= to &&
				Number.isFinite(point.close) &&
				point.close > 0
		);
		if (window.length < 2) return null;
		return window[window.length - 1].close / window[0].close - 1;
	}
}
