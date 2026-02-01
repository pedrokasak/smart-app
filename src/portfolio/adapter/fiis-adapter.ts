import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
	AssetQuote,
	AssetWithIndicators,
	IAssetApiAdapter,
} from 'src/assets/interface/asset.api.interface';

@Injectable()
export class FiisApiAdapter implements IAssetApiAdapter {
	private readonly baseUrl = 'https://brapi.dev/api';

	constructor(private readonly httpService: HttpService) {}

	async getQuote(symbol: string): Promise<AssetQuote> {
		try {
			// FII também usa Brapi, mas é um tipo diferente
			const url = `${this.baseUrl}/quote/${symbol}?fundamental=true`;
			const response = await firstValueFrom(this.httpService.get(url));

			const fii = response.data.results[0];

			return {
				symbol: fii.symbol,
				price: fii.regularMarketPrice,
				change: fii.regularMarketChange,
				changePercent: fii.regularMarketChangePercent,
				lastUpdate: new Date(),
			};
		} catch (error) {
			console.error('FiisAdapter - Erro:', error);
			throw error;
		}
	}

	async getIndicators(symbol: string): Promise<AssetWithIndicators> {
		try {
			const url = `${this.baseUrl}/quote/${symbol}?fundamental=true&dividends=true`;
			const response = await firstValueFrom(this.httpService.get(url));

			const fii = response.data.results[0];
			const quote = await this.getQuote(symbol);

			return {
				...quote,
				indicators: {
					dividendYield: fii.dividendYield || 0,
					marketCap: fii.marketCap,
					volume: fii.regularMarketVolume,
				},
			};
		} catch (error) {
			throw error;
		}
	}

	async searchAssets(query: string): Promise<any[]> {
		try {
			const apiKey = process.env.BRAPI_API_KEY;
			const url = `${this.baseUrl}/quote/list?search=${query}&type=fii&token=${apiKey}`;
			const response = await firstValueFrom(this.httpService.get(url));
			return response.data.stocks;
		} catch (error) {
			throw error;
		}
	}

	async validateConnection(): Promise<boolean> {
		try {
			await this.getQuote('MXRF11');
			return true;
		} catch {
			return false;
		}
	}
}
