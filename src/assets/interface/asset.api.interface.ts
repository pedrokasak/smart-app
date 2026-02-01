export interface AssetQuote {
	symbol: string;
	price: number;
	change: number;
	changePercent: number;
	lastUpdate: Date;
}

export interface AssetWithIndicators extends AssetQuote {
	indicators?: {
		dividendYield?: number;
		priceToEarnings?: number;
		marketCap?: number;
		volume?: number;
	};
}

// Interface genérica para qualquer tipo de API de ativo
export interface IAssetApiAdapter {
	getQuote(symbol: string): Promise<AssetQuote>;
	getIndicators(symbol: string): Promise<AssetWithIndicators>;
	searchAssets(query: string): Promise<any[]>;
	validateConnection(): Promise<boolean>;
}

export interface Asset {
	id: string;
	portfolioId: string; // ← Pertence a uma carteira específica
	symbol: string; // VALE3, PETR4, MXRF11, BTC, ETF etc
	quantity: number; // 100 ações
	price: number; // Preço médio de entrada
	total: number; // Valor total (quantity * price)
	type: 'stock' | 'fii' | 'etf' | 'crypto' | 'fund'; // Tipo de ativo
	source: 'manual' | 'b3' | 'webscrape'; // De onde veio
	addedAt: Date;
}
