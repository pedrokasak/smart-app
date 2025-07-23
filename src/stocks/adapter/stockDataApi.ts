export interface StockApiAdapter {
	getStockQuote(symbol: string): Promise<any>;
}
