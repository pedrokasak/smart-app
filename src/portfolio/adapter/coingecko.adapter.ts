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
		ADA: 'cardano',
		DOGE: 'dogecoin',
		SOL: 'solana',
		XRP: 'ripple',
		LTC: 'litecoin',
		TRX: 'tron',
		AVAX: 'avalanche-2',
		LINK: 'chainlink',
		DOT: 'polkadot',
		MATIC: 'matic-network',
		ARB: 'arbitrum',
		OP: 'optimism',
		SHIB: 'shiba-inu',
	};

	private async fetchSimplePrice(symbol: string): Promise<any> {
		const coinId = this.cryptoMap[symbol];
		if (!coinId) throw new Error(`Cripto ${symbol} não encontrada`);

		const url = `${this.baseUrl}/simple/price?ids=${coinId}&vs_currencies=brl&include_market_cap=true&include_24hr_change=true&include_24hr_vol=true`;
		const response = await firstValueFrom(this.httpService.get(url));
		return { coinId, data: response.data?.[coinId] };
	}

	async getQuote(symbol: string): Promise<AssetQuote> {
		try {
			const normalized = String(symbol || '').toUpperCase();
			const { data: cryptoData } = await this.fetchSimplePrice(normalized);
			if (!cryptoData) throw new Error(`Cripto ${normalized} sem cotação`);

			return {
				symbol: normalized,
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
			const normalized = String(symbol || '').toUpperCase();
			const { data: cryptoData } = await this.fetchSimplePrice(normalized);
			if (!cryptoData) throw new Error(`Cripto ${normalized} sem indicadores`);
			const quote: AssetQuote = {
				symbol: normalized,
				price: cryptoData.brl,
				change: cryptoData.brl_24h_change,
				changePercent: cryptoData.brl_24h_change,
				lastUpdate: new Date(),
			};

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
