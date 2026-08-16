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

export interface YahooPayoutInputs {
	payoutRatio: number | null;
	dividendsPaid: number | null;
	netIncome: number | null;
	fiscalPeriod: string | null;
}

const QUOTE_SUMMARY_MODULES = [
	'price',
	'summaryDetail',
	'defaultKeyStatistics',
	'financialData',
	'summaryProfile',
	'cashflowStatementHistory',
	'incomeStatementHistory',
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

	private async fetchQuoteSummary(yahooSymbol: string): Promise<any> {
		return yahooFinance.quoteSummary(
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
	}

	private fiscalYear(date: unknown): string | null {
		if (!date) return null;
		const parsed = date instanceof Date ? date : new Date(String(date));
		return Number.isNaN(parsed.getTime())
			? null
			: String(parsed.getUTCFullYear());
	}

	async getPayoutInputs(symbol: string): Promise<YahooPayoutInputs> {
		const empty: YahooPayoutInputs = {
			payoutRatio: null,
			dividendsPaid: null,
			netIncome: null,
			fiscalPeriod: null,
		};

		try {
			const raw = await this.fetchQuoteSummary(symbol);
			const cash = raw?.cashflowStatementHistory?.cashflowStatements?.[0];
			const income = raw?.incomeStatementHistory?.incomeStatementHistory?.[0];

			const cashYear = this.fiscalYear(cash?.endDate);
			const incomeYear = this.fiscalYear(income?.endDate);
			const samePeriod =
				cashYear !== null && incomeYear !== null && cashYear === incomeYear;

			return {
				payoutRatio: this.toNullableNumber(raw?.summaryDetail?.payoutRatio),
				dividendsPaid: this.toNullableNumber(cash?.dividendsPaid),
				netIncome: this.toNullableNumber(income?.netIncome),
				fiscalPeriod: samePeriod ? cashYear : null,
			};
		} catch {
			return empty;
		}
	}

	private async fetchSnapshot(
		yahooSymbol: string
	): Promise<YahooFundamentalsSnapshot | null> {
		try {
			const raw = await this.fetchQuoteSummary(yahooSymbol);

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
