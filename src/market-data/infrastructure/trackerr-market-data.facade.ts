import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
	B3_MARKET_DATA_PROVIDER,
	B3MarketDataProviderPort,
} from 'src/market-data/application/b3-market-data-provider.port';
import {
	MarketAssetSnapshot,
	MarketAssetType,
	MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import { FundamentusFallbackAdapter } from 'src/stocks/adapter/fundamentus-fallback.adapter';
import { StockService } from 'src/stocks/stocks.service';

@Injectable()
export class TrackerrMarketDataFacade implements MarketDataProviderPort {
	private readonly logger = new Logger(TrackerrMarketDataFacade.name);

	constructor(
		private readonly stockService: StockService,
		private readonly fundamentusFallback: FundamentusFallbackAdapter,
		@Optional()
		@Inject(B3_MARKET_DATA_PROVIDER)
		private readonly b3Provider?: B3MarketDataProviderPort
	) {}

	async getManyAssetSnapshots(
		symbols: string[]
	): Promise<MarketAssetSnapshot[]> {
		const uniqueSymbols = Array.from(
			new Set(
				symbols
					.map((symbol) =>
						String(symbol || '')
							.trim()
							.toUpperCase()
					)
					.filter(Boolean)
			)
		);

		const snapshots = await Promise.all(
			uniqueSymbols.map((symbol) => this.getAssetSnapshot(symbol))
		);
		return snapshots.filter(
			(snapshot): snapshot is MarketAssetSnapshot => !!snapshot
		);
	}

	async getAssetSnapshot(symbol: string): Promise<MarketAssetSnapshot | null> {
		const normalizedSymbol = String(symbol || '')
			.trim()
			.toUpperCase();
		if (!normalizedSymbol) {
			return null;
		}

		try {
			const nationalQuote = await this.stockService.getNationalQuote(
				normalizedSymbol,
				{
					fundamental: true,
					dividends: true,
				}
			);
			const primaryResult = nationalQuote?.results?.[0];
			if (primaryResult && !primaryResult?.unavailable) {
				return this.mapPrimarySnapshot(normalizedSymbol, primaryResult);
			}
		} catch (error) {
			this.logger.warn(
				`Primary market data unavailable for ${normalizedSymbol}: ${error?.message || error}`
			);
		}

		try {
			const globalQuote =
				await this.stockService.getStockQuoteGlobal(normalizedSymbol);
			const globalResult = globalQuote?.results?.[0];
			if (globalResult && !globalResult?.unavailable) {
				return this.mapPrimarySnapshot(normalizedSymbol, {
					...globalResult,
					fallbackSources: globalQuote?.fallbackSources || [],
					source: globalQuote?.source || 'primary',
				});
			}
		} catch (error) {
			this.logger.warn(
				`Global market data unavailable for ${normalizedSymbol}: ${error?.message || error}`
			);
		}

		if (this.b3Provider) {
			try {
				const b3Snapshot =
					await this.b3Provider.getAssetSnapshot(normalizedSymbol);
				if (b3Snapshot) {
					return {
						...b3Snapshot,
						metadata: {
							...b3Snapshot.metadata,
							source: b3Snapshot.metadata.source || 'primary',
							fallbackUsed: true,
							fallbackSources: Array.from(
								new Set([...(b3Snapshot.metadata.fallbackSources || []), 'b3'])
							),
						},
					};
				}
			} catch (error) {
				this.logger.warn(
					`B3 extension provider unavailable for ${normalizedSymbol}: ${error?.message || error}`
				);
			}
		}

		return this.loadFromFundamentusFallback(normalizedSymbol);
	}

	private async loadFromFundamentusFallback(
		symbol: string
	): Promise<MarketAssetSnapshot | null> {
		try {
			const snapshot = await this.fundamentusFallback.getSnapshot(symbol);
			const numeric = snapshot?.numeric || {};
			const hasData = Object.keys(numeric).length > 0;
			if (!hasData) {
				return null;
			}

			return {
				symbol,
				assetType: this.inferAssetType(symbol, undefined),
				sector: this.findTextValue(snapshot?.text || {}, ['SETOR']) || null,
				price: this.findNumericValue(numeric, ['COTACAO']) || null,
				dividendYield:
					this.findNumericValue(numeric, ['DIV YIELD', 'DY'], true) || null,
				performance: {
					changePercent: null,
				},
				fundamentals: {
					priceToEarnings: this.findNumericValue(numeric, ['P/L']) || null,
					priceToBook: this.findNumericValue(numeric, ['P/VP', 'PVP']) || null,
					returnOnEquity:
						this.findNumericValue(numeric, ['ROE', 'ROE %'], true) || null,
					netMargin:
						this.findNumericValue(
							numeric,
							['MARG LIQ', 'MARGEM LIQUIDA', 'M. LIQUIDA'],
							true
						) || null,
					evEbitda: this.findNumericValue(numeric, ['EV/EBITDA']) || null,
					marketCap:
						this.findNumericValue(numeric, ['VALOR DE MERCADO']) || null,
				},
				metadata: {
					source: 'fallback_fundamentus',
					fallbackUsed: true,
					partial: true,
					fallbackSources: ['fundamentus'],
				},
			};
		} catch (error) {
			this.logger.warn(
				`Fundamentus fallback failed for ${symbol}: ${error?.message || error}`
			);
			return null;
		}
	}

	private mapPrimarySnapshot(symbol: string, result: any): MarketAssetSnapshot {
		const fallbackSources = Array.isArray(result?.fallbackSources)
			? (result.fallbackSources as string[])
			: [];
		const fundamentals = {
			priceToEarnings: this.toNullableNumber(result?.priceEarnings),
			priceToBook: this.toNullableNumber(result?.priceToBook),
			returnOnEquity: this.toNullableNumber(result?.returnOnEquity),
			netMargin: this.toNullableNumber(result?.netMargin),
			evEbitda: this.toNullableNumber(result?.enterpriseValueEbitda),
			marketCap: this.toNullableNumber(result?.marketCap),
		};
		const partial = Object.values(fundamentals).some((value) => value === null);

		return {
			symbol,
			assetType: this.inferAssetType(symbol, result),
			sector: result?.sector ? String(result.sector) : null,
			price: this.toNullableNumber(result?.regularMarketPrice || result?.price),
			dividendYield: this.toNullableNumber(result?.dividendYield),
			performance: {
				changePercent: this.toNullableNumber(
					result?.regularMarketChangePercent || result?.changePercent
				),
			},
			fundamentals,
			metadata: {
				source: 'primary',
				fallbackUsed: fallbackSources.includes('fundamentus'),
				partial,
				fallbackSources,
			},
		};
	}

	private inferAssetType(symbol: string, result?: any): MarketAssetType {
		const fromPayload = String(result?.stockType || result?.assetType || '')
			.toLowerCase()
			.trim();
		if (fromPayload === 'fii') return 'fii';
		if (fromPayload === 'etf') return 'etf';
		if (fromPayload === 'crypto') return 'crypto';
		if (fromPayload === 'fund') return 'fund';

		if (/^[A-Z]{3,6}11$/.test(symbol)) {
			return 'fii';
		}
		if (
			/[-/](USD|USDT)$/.test(symbol) ||
			['BTC', 'ETH', 'SOL'].includes(symbol)
		) {
			return 'crypto';
		}
		return 'stock';
	}

	private normalizeKey(value: string): string {
		return String(value || '')
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^A-Z0-9]/gi, '')
			.toUpperCase();
	}

	private findNumericValue(
		numeric: Record<string, number>,
		aliases: string[],
		treatAsPercent = false
	): number | undefined {
		const normalizedEntries = new Map<string, number>();
		for (const [key, value] of Object.entries(numeric || {})) {
			if (typeof value !== 'number' || !Number.isFinite(value)) continue;
			normalizedEntries.set(this.normalizeKey(key), value);
		}
		for (const alias of aliases) {
			const value = normalizedEntries.get(this.normalizeKey(alias));
			if (value === undefined) continue;
			if (treatAsPercent && value > 1) return value / 100;
			return value;
		}
		return undefined;
	}

	private findTextValue(
		text: Record<string, string>,
		aliases: string[]
	): string | undefined {
		const normalizedEntries = new Map<string, string>();
		for (const [key, value] of Object.entries(text || {})) {
			if (!value) continue;
			normalizedEntries.set(this.normalizeKey(key), String(value).trim());
		}
		for (const alias of aliases) {
			const value = normalizedEntries.get(this.normalizeKey(alias));
			if (value) return value;
		}
		return undefined;
	}

	private toNullableNumber(value: unknown): number | null {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return null;
		}
		return value;
	}
}
