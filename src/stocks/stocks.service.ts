import { Injectable } from '@nestjs/common';
import { BrapiAdapter } from './adapter/brapiDataApi';
import { TwelveDataAdapter } from './adapter/twelveDataApi';

@Injectable()
export class StockService {
	constructor(
		private readonly brapi: BrapiAdapter,
		private readonly twelveData: TwelveDataAdapter
	) {}

	async getQuote(symbol: string, provider: 'twelve' | 'brapi') {
		if (provider === 'twelve') {
			return this.twelveData.getStockQuote(symbol);
		}
		return this.brapi.getStockQuote(symbol);
	}
}
