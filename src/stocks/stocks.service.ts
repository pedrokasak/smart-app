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

	async getAllNational(search = '', limit = 100, page = 1, sortBy = 'name') {
		return this.brapi.listAllStocks(search, sortBy, 'asc', limit, page);
	}

	async getNationalQuote(
		symbol: string,
		options?: {
			range?: string;
			interval?: string;
			fundamental?: boolean;
			dividends?: boolean;
		}
	) {
		const cleanSymbol = symbol.trim().toUpperCase();
		return this.brapi.getStockQuote(cleanSymbol, options);
	}

	async getStockQuoteGlobal(symbol: string): Promise<any> {
		console.log('Fetching global stock quote for:', symbol);
		return this.twelveData.getStockQuote(symbol);
	}
}
