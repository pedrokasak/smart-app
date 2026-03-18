import { Controller, Get, Query } from '@nestjs/common';
import { StockService } from './stocks.service';
import {
	ApiBearerAuth,
	ApiOkResponse,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';

@Controller('stocks')
@ApiTags('stocks')
@ApiBearerAuth('access-token')
export class StocksController {
	constructor(private readonly stockService: StockService) {}

	@Get('all/national')
	@ApiResponse({ status: 200, description: 'OK' })
	@ApiResponse({ status: 400, description: 'Bad Request' })
	@ApiResponse({ status: 500, description: 'Internal Server Error' })
	@ApiOkResponse({ description: 'OK', type: [Object] })
	async getAllNational(
		@Query('search') search = '',
		@Query('limit') limit = '100',
		@Query('page') page = '1',
		@Query('sortBy') sortBy = 'name'
	) {
		return this.stockService.getAllNational(
			search,
			parseInt(limit),
			parseInt(page),
			sortBy
		);
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
	async getStockQuoteNational(
		@Query('symbol') symbol: string,
		@Query('fundamental') fundamental?: string,
		@Query('dividends') dividends?: string,
		@Query('range') range?: string,
		@Query('interval') interval?: string
	) {
		if (!symbol) {
			return { error: 'O parâmetro symbol é obrigatório' };
		}
		return this.stockService.getNationalQuote(symbol, {
			fundamental: fundamental === 'true',
			dividends: dividends === 'true',
			range,
			interval,
		});
	}
}
