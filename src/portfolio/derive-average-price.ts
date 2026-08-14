import { AveragePriceService } from 'src/fiscal/services/average-price.service';
import type { Trade } from 'src/fiscal/domain/trade';

export interface DerivableAsset {
	symbol: string;
	avgPrice?: number;
}

export interface DerivableTrade {
	symbol: string;
	side: 'buy' | 'sell';
	quantity: number;
	price: number;
	fees?: number;
	date: Date;
}

const averagePriceService = new AveragePriceService();

export function withDerivedAveragePrice<T extends DerivableAsset>(
	assets: T[],
	trades: DerivableTrade[]
): T[] {
	const tradesBySymbol = new Map<string, Trade[]>();
	for (const trade of trades) {
		const key = String(trade.symbol || '').toUpperCase();
		if (!key) continue;
		const list = tradesBySymbol.get(key) ?? [];
		list.push({
			assetSymbol: key,
			side: trade.side,
			quantity: Number(trade.quantity) || 0,
			price: Number(trade.price) || 0,
			fees: Number(trade.fees) || 0,
			date: trade.date,
		});
		tradesBySymbol.set(key, list);
	}

	return assets.map((asset) => {
		// Valor manual sempre vence: foi o usuário que digitou, ou o
		// broker-sync que já calculou na importação da nota.
		if (typeof asset.avgPrice === 'number' && asset.avgPrice > 0) {
			return asset;
		}

		const symbolTrades = tradesBySymbol.get(
			String(asset.symbol || '').toUpperCase()
		);
		if (!symbolTrades?.length) return asset;

		const { averagePrice } = averagePriceService.calculate(symbolTrades);

		// Posição zerada devolve 0. Gravar esse 0 recriaria exatamente o bug
		// que este trabalho corrige — custo zero lido como "de graça".
		if (!(averagePrice > 0)) return asset;

		return { ...asset, avgPrice: averagePrice };
	});
}
