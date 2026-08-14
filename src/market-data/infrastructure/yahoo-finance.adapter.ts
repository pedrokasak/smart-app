import { Injectable, Logger } from '@nestjs/common';
import yahooFinance from 'yahoo-finance2';
import { MarketAssetType } from 'src/market-data/application/market-data-provider.port';
import { normalizeTickerForProvider } from 'src/market-data/infrastructure/ticker-normalizer';

export interface YahooHistoryPoint {
	date: number; // epoch em SEGUNDOS, igual ao historicalDataPrice do brapi
	close: number;
}

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
		{ expiresAt: number; data: YahooFundamentalsSnapshot | null }
	>();
	private static readonly inflight = new Map<
		string,
		Promise<YahooFundamentalsSnapshot | null>
	>();
	private static readonly CACHE_TTL_MS = 10 * 60 * 1000;
	private static readonly NEGATIVE_CACHE_TTL_MS = 3 * 60 * 1000;
	private static readonly FETCH_TIMEOUT_MS = 8000;
	private static readonly RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
	private static noticesSuppressed = false;
	private static rateLimitedUntil = 0;

	constructor() {
		if (
			!YahooFinanceAdapter.noticesSuppressed &&
			typeof (yahooFinance as any)?.suppressNotices === 'function'
		) {
			try {
				(yahooFinance as any).suppressNotices(['yahooSurvey']);
			} catch (error) {
				this.logger.warn(
					`Falha ao suprimir avisos do Yahoo Finance: ${error?.message || error}`
				);
			} finally {
				YahooFinanceAdapter.noticesSuppressed = true;
			}
		}
	}

	private toNullableNumber(value: unknown): number | null {
		return typeof value === 'number' && Number.isFinite(value) ? value : null;
	}

	private isRateLimitError(error: unknown): boolean {
		if (!error) return false;
		const err = error as {
			response?: { status?: number };
			status?: number;
			message?: unknown;
		};
		const status = err?.response?.status ?? err?.status;
		if (status === 429) return true;
		const message =
			typeof err?.message === 'string' ? err.message : String(error);
		return /too many requests/i.test(message);
	}

	async getSnapshot(
		symbol: string,
		assetType: MarketAssetType
	): Promise<YahooFundamentalsSnapshot | null> {
		const yahooSymbol = normalizeTickerForProvider(symbol, 'yahoo', assetType);
		const now = Date.now();
		const cached = YahooFinanceAdapter.cache.get(yahooSymbol);
		if (cached && cached.expiresAt > now && cached.data !== null) {
			return cached.data;
		}

		if (YahooFinanceAdapter.rateLimitedUntil > now) {
			return null;
		}

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

	// O yahoo pede uma data inicial, não um range nomeado. Estes são os
	// mesmos rótulos que a UI usa.
	private rangeToPeriod1(range: string): Date {
		const days: Record<string, number> = {
			'1d': 2,
			'5d': 7,
			'1mo': 31,
			'3mo': 93,
			'6mo': 186,
			'1y': 366,
			'2y': 731,
			'5y': 1827,
			'10y': 3653,
		};
		const span = days[range.trim().toLowerCase()] ?? 366;
		const start = new Date();
		start.setDate(start.getDate() - span);
		return start;
	}

	async getHistory(
		symbol: string,
		assetType: MarketAssetType,
		range: string
	): Promise<YahooHistoryPoint[]> {
		if (YahooFinanceAdapter.rateLimitedUntil > Date.now()) {
			return [];
		}

		const yahooSymbol = normalizeTickerForProvider(symbol, 'yahoo', assetType);

		try {
			const result = await (yahooFinance as any).chart(yahooSymbol, {
				period1: this.rangeToPeriod1(range),
				interval: '1d',
			});

			const quotes: Array<{ date?: Date; close?: number | null }> =
				result?.quotes ?? [];

			return quotes
				.filter(
					(quote) =>
						quote?.date instanceof Date &&
						typeof quote.close === 'number' &&
						Number.isFinite(quote.close)
				)
				.map((quote) => ({
					date: Math.floor(quote.date!.getTime() / 1000),
					close: quote.close as number,
				}));
		} catch (error) {
			if (this.isRateLimitError(error)) {
				const now = Date.now();
				const alreadyRateLimited = YahooFinanceAdapter.rateLimitedUntil > now;
				YahooFinanceAdapter.rateLimitedUntil =
					now + YahooFinanceAdapter.RATE_LIMIT_COOLDOWN_MS;
				if (!alreadyRateLimited) {
					this.logger.warn(
						`Yahoo Finance retornou rate limit (429). Pausando consultas por ${YahooFinanceAdapter.RATE_LIMIT_COOLDOWN_MS / 1000}s.`
					);
				}
				return [];
			}

			this.logger.warn(
				`Falha ao buscar histórico no Yahoo Finance para ${yahooSymbol}: ${error?.message || error}`
			);
			return [];
		}
	}

	private async fetchSnapshot(
		yahooSymbol: string
	): Promise<YahooFundamentalsSnapshot | null> {
		try {
			const raw = await yahooFinance.quoteSummary(
				yahooSymbol,
				{
					modules: [...QUOTE_SUMMARY_MODULES],
				},
				{
					fetchOptions: {
						signal: AbortSignal.timeout(YahooFinanceAdapter.FETCH_TIMEOUT_MS),
					},
				}
			);

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
				priceToBook: this.toNullableNumber(
					raw?.defaultKeyStatistics?.priceToBook
				),
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
			if (this.isRateLimitError(error)) {
				const now = Date.now();
				const alreadyRateLimited = YahooFinanceAdapter.rateLimitedUntil > now;
				YahooFinanceAdapter.rateLimitedUntil =
					now + YahooFinanceAdapter.RATE_LIMIT_COOLDOWN_MS;
				if (!alreadyRateLimited) {
					this.logger.warn(
						`Yahoo Finance retornou rate limit (429). Pausando consultas por ${YahooFinanceAdapter.RATE_LIMIT_COOLDOWN_MS / 1000}s.`
					);
				}
				return null;
			}

			this.logger.warn(
				`Falha ao consultar Yahoo Finance para ${yahooSymbol}: ${error?.message || error}`
			);
			YahooFinanceAdapter.cache.set(yahooSymbol, {
				expiresAt: Date.now() + YahooFinanceAdapter.NEGATIVE_CACHE_TTL_MS,
				data: null,
			});
			return null;
		}
	}
}
