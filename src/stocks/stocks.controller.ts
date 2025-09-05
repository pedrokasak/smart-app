import { Controller, Get, Query } from '@nestjs/common';
import { StockService } from './stocks.service';

@Controller('stocks')
export class StocksController {
	constructor(private readonly stockService: StockService) {}

	@Get('all/national')
	async getAllNational() {
		console.log('Fetching all national stocks');
		return this.stockService.getAllNational();
	}

	@Get('global/quote')
	async getStockQuoteGlobal(@Query('symbol') symbol: string) {
		if (!symbol) {
			return { error: 'O parâmetro symbol é obrigatório' };
		}
		return this.stockService.getStockQuoteGlobal(symbol);
	}

	@Get('national/quote')
	async getStockQuoteNational(@Query('symbol') symbol: string) {
		if (!symbol) {
			return { error: 'O parâmetro symbol é obrigatório' };
		}
		return this.stockService.getNationalQuote(symbol);
	}
}
