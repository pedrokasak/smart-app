import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
	AssetQuote,
	AssetWithIndicators,
	IAssetApiAdapter,
} from 'src/assets/interface/asset.api.interface';

@Injectable()
export class TwelveDataEtfAdapter implements IAssetApiAdapter {
	private readonly baseUrl = 'https://api.twelvedata.com';
	private readonly apiKey = process.env.TWELVE_DATA_API_KEY;

	constructor(private readonly httpService: HttpService) {}

	async getQuote(symbol: string): Promise<AssetQuote> {
		try {
			const url = `${this.baseUrl}/quote?symbol=${symbol}&apikey=${this.apiKey}`;
			const response = await firstValueFrom(this.httpService.get(url));

			const etf = response.data;

			return {
				symbol: etf.symbol,
				price: parseFloat(etf.close),
				change: parseFloat(etf.change),
				changePercent: parseFloat(etf.percent_change),
				lastUpdate: new Date(),
			};
		} catch (error) {
			console.error('TwelveDataAdapter - Erro:', error);
			throw error;
		}
	}

	async getIndicators(symbol: string): Promise<AssetWithIndicators> {
		try {
			const url = `${this.baseUrl}/quote?symbol=${symbol}&apikey=${this.apiKey}`;
			const response = await firstValueFrom(this.httpService.get(url));

			const quote = await this.getQuote(symbol);

			return {
				...quote,
				indicators: {
					volume: parseInt(response.data.volume),
				},
			};
		} catch (error) {
			throw error;
		}
	}

	async searchAssets(query: string): Promise<any[]> {
		try {
			const url = `${this.baseUrl}/symbol/search?query=${query}&apikey=${this.apiKey}`;
			const response = await firstValueFrom(this.httpService.get(url));
			return response.data.data;
		} catch (error) {
			throw error;
		}
	}

	async validateConnection(): Promise<boolean> {
		try {
			await this.getQuote('AAPL');
			return true;
		} catch {
			return false;
		}
	}
}
