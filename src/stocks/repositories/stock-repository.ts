export abstract class StockRepository {
	// abstract getQuote(symbol: string, provider: 'twelve' | 'brapi'): Promise<any>;
	abstract getStockQuoteGlobal(symbol: string): Promise<any>;
	abstract getNationalQuote(symbol: string): Promise<any>;
	abstract getAllNational(): Promise<any>;
}
