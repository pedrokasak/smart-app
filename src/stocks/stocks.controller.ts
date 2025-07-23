import { Controller, Get, Query } from '@nestjs/common';
import { StockService } from './stocks.service';

@Controller('stocks')
export class StocksController {
	constructor(private readonly stockService: StockService) {}

	@Get('quote')
	async getStockQuote(@Query('symbol') symbol: string) {
		if (!symbol) {
			return { error: 'O parâmetro symbol é obrigatório' };
		}
		return this.stockService.getQuote(symbol, 'brapi');
	}
}
