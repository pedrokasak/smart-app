import { Injectable } from '@nestjs/common';
import { BrapiStockAdapter } from 'src/portfolio/adapter/brapi.adapter';
import { CoinGeckoAdapter } from 'src/portfolio/adapter/coingecko.adapter';
import { FiisApiAdapter } from 'src/portfolio/adapter/fiis-adapter';
import { TwelveDataEtfAdapter } from 'src/portfolio/adapter/twelvedata.adapter';
import { IAssetApiAdapter } from 'src/assets/interface/asset.api.interface';

export type AssetType = 'stock' | 'fii' | 'etf' | 'crypto' | 'fund';

@Injectable()
export class AssetAdapterFactory {
	constructor(
		private brapiStockAdapter: BrapiStockAdapter,
		private fiisApiAdapter: FiisApiAdapter,
		private coinGeckoAdapter: CoinGeckoAdapter,
		private twelveDataEtfAdapter: TwelveDataEtfAdapter
	) {}

	/**
	 * Retorna o adapter apropriado baseado no tipo de ativo
	 */
	getAdapter(assetType: AssetType): IAssetApiAdapter {
		switch (assetType) {
			case 'stock':
				return this.brapiStockAdapter;
			case 'fii':
				return this.fiisApiAdapter;
			case 'crypto':
				return this.coinGeckoAdapter;
			case 'etf':
				return this.twelveDataEtfAdapter;
			case 'fund':
				return this.brapiStockAdapter; // Fallback
			default:
				throw new Error(`Tipo de ativo não suportado: ${assetType}`);
		}
	}

	/**
	 * Detecta o tipo de ativo pelo símbolo
	 */
	detectAssetType(symbol: string): AssetType {
		const upperSymbol = symbol.toUpperCase();

		// FII termina com "11"
		if (upperSymbol.endsWith('11')) {
			return 'fii';
		}

		// Crypto conhecidas
		if (['BTC', 'ETH', 'USDT', 'USDC', 'BNB'].includes(upperSymbol)) {
			return 'crypto';
		}

		// Ações brasileiras (terminam com número 3, 4, 5, 6)
		if (/^[A-Z]{4}[3-6]$/.test(upperSymbol)) {
			return 'stock';
		}

		// ETF internacional (AAPL, GOOGL, etc)
		if (upperSymbol.length <= 5 && /^[A-Z]+$/.test(upperSymbol)) {
			return 'etf';
		}

		return 'stock'; // Default
	}
}
