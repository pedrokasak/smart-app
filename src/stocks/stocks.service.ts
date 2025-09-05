import { Injectable } from '@nestjs/common';
import { BrapiAdapter } from './adapter/brapiDataApi';
import { TwelveDataAdapter } from './adapter/twelveDataApi';
import { StockRepository } from 'src/stocks/repositories/stock-repository';

@Injectable()
export class StockService implements StockRepository {
	constructor(
		private readonly brapi: BrapiAdapter,
		private readonly twelveData: TwelveDataAdapter
	) {}

	async getAllNational() {
		return this.brapi.listAllStocks();
	}

	async getNationalQuote(symbol: string) {
		return this.brapi.getStockQuote(symbol);
	}

	async getStockQuoteGlobal(symbol: string): Promise<any> {
		console.log('Fetching global stock quote for:', symbol);
		return this.twelveData.getStockQuote(symbol);
	}
	// async getQuote(symbol: string, provider: 'twelve' | 'brapi') {
	// 	if (provider === 'twelve') {
	// 		return this.twelveData.getStockQuote(symbol);
	// 	}
	// 	return this.brapi.getStockQuote(symbol);
	// }
}
