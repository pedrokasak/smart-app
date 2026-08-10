import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
	AssetQuote,
	AssetWithIndicators,
	IAssetApiAdapter,
} from 'src/assets/interface/asset.api.interface';
import {
	MARKET_DATA_PROVIDER,
	MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';

@Injectable()
export class BrapiStockAdapter implements IAssetApiAdapter {
	private readonly baseUrl = 'https://brapi.dev/api';

	constructor(
		private readonly httpService: HttpService,
		@Inject(MARKET_DATA_PROVIDER)
		private readonly marketData: MarketDataProviderPort
	) {}

	async getQuote(
		symbols: string,
		options?: { fundamental?: boolean; dividends?: boolean }
	): Promise<AssetQuote> {
		try {
			const fund = options?.fundamental ?? true;
			const div = options?.dividends ?? true;
			const url = `${this.baseUrl}/quote/${symbols}?fundamental=${fund}&dividends=${div}`;
			const response = await firstValueFrom(
				this.httpService.get(url, {
					headers: { 'User-Agent': 'SmartFolio App' },
				})
			);

			const stock = response.data.results[0];

			return {
				symbol: stock.symbol,
				price: stock.regularMarketPrice,
				change: stock.regularMarketChange,
				changePercent: stock.regularMarketChangePercent,
				lastUpdate: new Date(),
				restrictedData: stock.restrictedData || [],
			};
		} catch (error) {
			const errorData = error?.response?.data;
			if (errorData?.code === 'FEATURE_NOT_AVAILABLE' || errorData?.error) {
				const msg = errorData.message || '';
				if (msg.includes('dividend') || msg.includes('dividendo')) {
					return this.getQuote(symbols, {
						fundamental: options?.fundamental,
						dividends: false,
					});
				}
				if (msg.includes('fundamental') || msg.includes('indicadores')) {
					return this.getQuote(symbols, {
						fundamental: false,
						dividends: options?.dividends,
					});
				}
				// Fallback generic retry
				if (options?.fundamental !== false || options?.dividends !== false) {
					return this.getQuote(symbols, {
						fundamental: false,
						dividends: false,
					});
				}
			}
			console.error('BrapiAdapter - Erro ao buscar cotação:', error);
			throw error;
		}
	}

	async getIndicators(symbol: string): Promise<AssetWithIndicators> {
		try {
			const quote = await this.getQuote(symbol, {
				fundamental: true,
				dividends: true,
			});

			// We need to re-fetch if we use getQuote because it doesn't return the raw stock object
			// Actually, let's optimize getIndicators to be more robust
			const url = `${this.baseUrl}/quote/${symbol}?fundamental=true&dividends=true`;
			let response;
			try {
				response = await firstValueFrom(this.httpService.get(url));
			} catch (e: any) {
				const errorData = e?.response?.data;
				if (errorData?.code === 'FEATURE_NOT_AVAILABLE') {
					// Retry with minimal data
					response = await firstValueFrom(
						this.httpService.get(`${this.baseUrl}/quote/${symbol}`)
					);
				} else {
					throw e;
				}
			}

			const stock = response.data.results[0];

			let indicators: AssetWithIndicators['indicators'] =
				stock.dividendYield || stock.epsTrailingTwelveMonths
					? {
							dividendYield: stock.dividendYield || 0,
							priceToEarnings: stock.epsTrailingTwelveMonths
								? stock.regularMarketPrice / stock.epsTrailingTwelveMonths
								: 0,
							marketCap: stock.marketCap,
							volume: stock.regularMarketVolume,
						}
					: undefined;

			if (!indicators) {
				const snapshot = await this.marketData.getAssetSnapshot(symbol);
				if (snapshot) {
					indicators = {
						dividendYield: snapshot.dividendYield ?? undefined,
						priceToEarnings: snapshot.fundamentals.priceToEarnings ?? undefined,
						marketCap: snapshot.fundamentals.marketCap ?? undefined,
						volume: undefined,
					};
					const hasAnyValue = Object.values(indicators).some(
						(value) => value !== undefined
					);
					if (!hasAnyValue) indicators = undefined;
				}
			}

			return {
				...quote,
				indicators,
				restrictedData:
					stock.restrictedData ||
					(quote.restrictedData?.length ? quote.restrictedData : undefined),
			};
		} catch (error) {
			console.error('BrapiAdapter - Erro ao buscar indicadores:', error);
			throw error;
		}
	}

	async searchAssets(query: string): Promise<any[]> {
		try {
			const apiKey = process.env.BRAPI_API_KEY;
			const url = `${this.baseUrl}/quote/list?search=${query}&type=stock&token=${apiKey}`;
			const response = await firstValueFrom(this.httpService.get(url));
			return response.data.stocks;
		} catch (error) {
			console.error('BrapiAdapter - Erro ao listar ações:', error);
			throw error;
		}
	}

	async validateConnection(): Promise<boolean> {
		try {
			await this.getQuote('PETR4');
			return true;
		} catch {
			return false;
		}
	}
}
