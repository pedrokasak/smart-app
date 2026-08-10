import { Injectable, Logger } from '@nestjs/common';
import yahooFinance from 'yahoo-finance2';
import { MarketAssetType } from 'src/market-data/application/market-data-provider.port';
import { normalizeTickerForProvider } from 'src/market-data/infrastructure/ticker-normalizer';

export interface YahooFundamentalsSnapshot {
	price: number | null;
	dividendYield: number | null;
	sector: string | null;
	changePercent: number | null;
	priceToEarnings: number | null;
	priceToBook: number | null;
	returnOnEquity: number | null;
	netMargin: number | null;
	evEbitda: number | null;
	marketCap: number | null;
}

const QUOTE_SUMMARY_MODULES = [
	'price',
	'summaryDetail',
	'defaultKeyStatistics',
	'financialData',
	'summaryProfile',
] as const;

@Injectable()
export class YahooFinanceAdapter {
	private readonly logger = new Logger(YahooFinanceAdapter.name);
	private static readonly cache = new Map<
		string,
		{ expiresAt: number; data: YahooFundamentalsSnapshot }
	>();
	private static readonly inflight = new Map<
		string,
		Promise<YahooFundamentalsSnapshot | null>
	>();
	private static readonly CACHE_TTL_MS = 10 * 60 * 1000;

	private toNullableNumber(value: unknown): number | null {
		return typeof value === 'number' && Number.isFinite(value) ? value : null;
	}

	async getSnapshot(
		symbol: string,
		assetType: MarketAssetType
	): Promise<YahooFundamentalsSnapshot | null> {
		const yahooSymbol = normalizeTickerForProvider(symbol, 'yahoo', assetType);
		const now = Date.now();
		const cached = YahooFinanceAdapter.cache.get(yahooSymbol);
		if (cached && cached.expiresAt > now) return cached.data;

		const existingRequest = YahooFinanceAdapter.inflight.get(yahooSymbol);
		if (existingRequest) return existingRequest;

		const request = this.fetchSnapshot(yahooSymbol);
		YahooFinanceAdapter.inflight.set(yahooSymbol, request);
		try {
			return await request;
		} finally {
			YahooFinanceAdapter.inflight.delete(yahooSymbol);
		}
	}

	private async fetchSnapshot(
		yahooSymbol: string
	): Promise<YahooFundamentalsSnapshot | null> {
		try {
			const raw = await yahooFinance.quoteSummary(yahooSymbol, {
				modules: [...QUOTE_SUMMARY_MODULES],
			});

			const snapshot: YahooFundamentalsSnapshot = {
				price: this.toNullableNumber(raw?.price?.regularMarketPrice),
				dividendYield: this.toNullableNumber(raw?.summaryDetail?.dividendYield),
				sector: raw?.summaryProfile?.sector
					? String(raw.summaryProfile.sector)
					: null,
				changePercent: this.toNullableNumber(
					raw?.price?.regularMarketChangePercent
				),
				priceToEarnings: this.toNullableNumber(raw?.summaryDetail?.trailingPE),
				priceToBook: this.toNullableNumber(raw?.defaultKeyStatistics?.priceToBook),
				returnOnEquity: this.toNullableNumber(
					raw?.financialData?.returnOnEquity
				),
				netMargin: this.toNullableNumber(raw?.financialData?.profitMargins),
				evEbitda: this.toNullableNumber(
					raw?.defaultKeyStatistics?.enterpriseToEbitda
				),
				marketCap: this.toNullableNumber(raw?.summaryDetail?.marketCap),
			};

			YahooFinanceAdapter.cache.set(yahooSymbol, {
				expiresAt: Date.now() + YahooFinanceAdapter.CACHE_TTL_MS,
				data: snapshot,
			});
			return snapshot;
		} catch (error) {
			this.logger.warn(
				`Falha ao consultar Yahoo Finance para ${yahooSymbol}: ${error?.message || error}`
			);
			return null;
		}
	}
}
