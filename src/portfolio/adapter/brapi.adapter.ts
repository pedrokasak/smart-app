import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
	AssetQuote,
	AssetWithIndicators,
	IAssetApiAdapter,
} from 'src/assets/interface/asset.api.interface';

@Injectable()
export class BrapiStockAdapter implements IAssetApiAdapter {
	private readonly baseUrl = 'https://brapi.dev/api';

	constructor(private readonly httpService: HttpService) {}

	async getQuote(symbols: string): Promise<AssetQuote> {
		try {
			const url = `${this.baseUrl}/quote/${symbols}?fundamental=true&dividends=true`;
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
			};
		} catch (error) {
			console.error('BrapiAdapter - Erro ao buscar cotação:', error);
			throw error;
		}
	}

	async getIndicators(symbol: string): Promise<AssetWithIndicators> {
		try {
			const url = `${this.baseUrl}/quote/${symbol}?fundamental=true&dividends=true`;
			const response = await firstValueFrom(this.httpService.get(url));

			const stock = response.data.results[0];
			const quote = await this.getQuote(symbol);

			return {
				...quote,
				indicators: {
					dividendYield: stock.dividendYield || 0,
					priceToEarnings:
						stock.regularMarketPrice / (stock.epsTrailingTwelveMonths || 1),
					marketCap: stock.marketCap,
					volume: stock.regularMarketVolume,
				},
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
