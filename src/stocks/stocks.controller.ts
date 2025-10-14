import { Controller, Get, Query } from '@nestjs/common';
import { StockService } from './stocks.service';
import { ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';

@Controller('stocks')
@ApiTags('stocks')
export class StocksController {
	constructor(private readonly stockService: StockService) {}

	@Get('all/national')
	@ApiResponse({ status: 200, description: 'OK' })
	@ApiResponse({ status: 400, description: 'Bad Request' })
	@ApiResponse({ status: 500, description: 'Internal Server Error' })
	@ApiOkResponse({ description: 'OK', type: [Object] })
	async getAllNational() {
		console.log('Fetching all national stocks');
		return this.stockService.getAllNational();
	}

	@Get('global/quote')
	@ApiResponse({ status: 200, description: 'OK' })
	@ApiResponse({ status: 400, description: 'Bad Request' })
	@ApiResponse({ status: 500, description: 'Internal Server Error' })
	async getStockQuoteGlobal(@Query('symbol') symbol: string) {
		if (!symbol) {
			return { error: 'O parâmetro symbol é obrigatório' };
		}
		return this.stockService.getStockQuoteGlobal(symbol);
	}

	@Get('national/quote')
	@ApiResponse({ status: 200, description: 'OK' })
	@ApiResponse({ status: 400, description: 'Bad Request' })
	@ApiResponse({ status: 500, description: 'Internal Server Error' })
	async getStockQuoteNational(@Query('symbol') symbol: string) {
		if (!symbol) {
			return { error: 'O parâmetro symbol é obrigatório' };
		}
		return this.stockService.getNationalQuote(symbol);
	}
}
