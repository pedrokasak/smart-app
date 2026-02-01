import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
	AssetQuote,
	AssetWithIndicators,
	IAssetApiAdapter,
} from 'src/assets/interface/asset.api.interface';

@Injectable()
export class CoinGeckoAdapter implements IAssetApiAdapter {
	private readonly baseUrl = 'https://api.coingecko.com/api/v3';

	constructor(private readonly httpService: HttpService) {}

	private readonly cryptoMap: Record<string, string> = {
		BTC: 'bitcoin',
		ETH: 'ethereum',
		USDT: 'tether',
		USDC: 'usd-coin',
		BNB: 'binancecoin',
	};

	async getQuote(symbol: string): Promise<AssetQuote> {
		try {
			const coinId = this.cryptoMap[symbol];
			if (!coinId) throw new Error(`Cripto ${symbol} não encontrada`);

			const url = `${this.baseUrl}/simple/price?ids=${coinId}&vs_currencies=brl&include_market_cap=true&include_24hr_change=true`;
			const response = await firstValueFrom(this.httpService.get(url));

			const cryptoData = response.data[coinId];

			return {
				symbol,
				price: cryptoData.brl,
				change: cryptoData.brl_24h_change,
				changePercent: cryptoData.brl_24h_change,
				lastUpdate: new Date(),
			};
		} catch (error) {
			console.error('CoinGeckoAdapter - Erro:', error);
			throw error;
		}
	}

	async getIndicators(symbol: string): Promise<AssetWithIndicators> {
		try {
			const coinId = this.cryptoMap[symbol];
			const url = `${this.baseUrl}/simple/price?ids=${coinId}&vs_currencies=brl&include_market_cap=true&include_24hr_vol=true`;
			const response = await firstValueFrom(this.httpService.get(url));

			const cryptoData = response.data[coinId];
			const quote = await this.getQuote(symbol);

			return {
				...quote,
				indicators: {
					marketCap: cryptoData.brl_market_cap,
					volume: cryptoData.brl_24h_vol,
				},
			};
		} catch (error) {
			throw error;
		}
	}

	async searchAssets(query: string): Promise<any[]> {
		try {
			const url = `${this.baseUrl}/search?query=${query}`;
			const response = await firstValueFrom(this.httpService.get(url));
			return response.data.coins;
		} catch (error) {
			throw error;
		}
	}

	async validateConnection(): Promise<boolean> {
		try {
			await this.getQuote('BTC');
			return true;
		} catch {
			return false;
		}
	}
}
