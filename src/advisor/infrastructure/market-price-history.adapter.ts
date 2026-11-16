import { Inject, Injectable, Logger } from '@nestjs/common';
import {
	MARKET_DATA_PROVIDER,
	type MarketAssetType,
	type MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import {
	DailyCloseMinor,
	PriceHistoryPort,
} from '../application/ports/price-history.port';
import { AssetClass } from '../domain/enums';

/** Ranges aceitos pelo provider, do menor ao maior, com a janela em dias. */
const RANGES: ReadonlyArray<{ range: string; days: number }> = [
	{ range: '1mo', days: 31 },
	{ range: '3mo', days: 93 },
	{ range: '6mo', days: 186 },
	{ range: '1y', days: 366 },
	{ range: '2y', days: 731 },
	{ range: '5y', days: 1827 },
	{ range: '10y', days: 3653 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

const ASSET_TYPE_BY_CLASS: Partial<Record<AssetClass, MarketAssetType>> = {
	[AssetClass.Stock]: 'stock',
	[AssetClass.Fii]: 'fii',
	[AssetClass.Etf]: 'etf',
	[AssetClass.Crypto]: 'crypto',
	[AssetClass.Fund]: 'fund',
};

/**
 * Menor range aceito pelo provider que cobre `from`..`today`, com teto de 10
 * anos. `today` entra como argumento: a função não lê o relógio.
 */
export function selectProviderRange(from: string, today: string): string {
	const span = Math.ceil(
		(Date.parse(`${today}T00:00:00.000Z`) -
			Date.parse(`${from}T00:00:00.000Z`)) /
			DAY_MS
	);
	const match = RANGES.find((entry) => entry.days >= span);
	return (match ?? RANGES[RANGES.length - 1]).range;
}

/** Histórico de fechamentos do Advisor servido pelo provider de mercado. */
@Injectable()
export class MarketPriceHistoryAdapter implements PriceHistoryPort {
	private readonly logger = new Logger(MarketPriceHistoryAdapter.name);

	constructor(
		@Inject(MARKET_DATA_PROVIDER)
		private readonly market: MarketDataProviderPort
	) {}

	async getDailyCloses(
		symbol: string,
		assetClass: AssetClass,
		from: string,
		to: string
	): Promise<DailyCloseMinor[]> {
		const assetType = ASSET_TYPE_BY_CLASS[assetClass];
		if (!assetType) return [];
		try {
			const today = new Date().toISOString().slice(0, 10);
			const closes = await this.market.getDailyCloses(
				symbol,
				selectProviderRange(from, today),
				assetType
			);
			const result: DailyCloseMinor[] = [];
			for (const point of closes) {
				if (point.date < from || point.date > to) continue;
				if (!Number.isFinite(point.close) || point.close <= 0) continue;
				result.push({
					date: point.date,
					closeMinor: Math.round(point.close * 100),
				});
			}
			return result;
		} catch (error) {
			this.logger.warn(
				`Histórico de preço de ${symbol} indisponível: ${
					error instanceof Error ? error.message : 'unknown_error'
				}`
			);
			return [];
		}
	}
}
