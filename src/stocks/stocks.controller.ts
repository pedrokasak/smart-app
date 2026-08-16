import { Controller, Get, Logger, Query } from '@nestjs/common';
import { StockService } from './stocks.service';
import { FundamentalsService } from './fundamentals/fundamentals.service';
import {
	ApiBearerAuth,
	ApiOkResponse,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';

// Tamanho do lote de enriquecimento de fundamentos por requisicao. O endpoint
// aceita simbolos separados por virgula (?symbol=PETR4,VALE3,...), entao um
// Promise.all sem limite dispara N navegacoes de pagina no Fundamentus e N
// chamadas ao Yahoo em paralelo. O adapter do Fundamentus reutiliza um unico
// browser (uma aba nova por scrape, nao um Chromium novo) e deduplica
// requisicoes em voo para o MESMO simbolo, mas isso nao ajuda com N simbolos
// DISTINTOS na mesma requisicao — e o Yahoo ja rate-limita este projeto. 5
// mantem o fan-out pequeno o bastante para nao estourar o Yahoo em consultas
// de carteira tipicas (poucos ativos) sem serializar tudo em requisicoes com
// muitos simbolos.
export const FUNDAMENTALS_BATCH_SIZE = 5;

@Controller('stocks')
@ApiTags('stocks')
@ApiBearerAuth('access-token')
export class StocksController {
	private readonly logger = new Logger(StocksController.name);

	constructor(
		private readonly stockService: StockService,
		private readonly fundamentalsService: FundamentalsService
	) {}

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

	@Get('macro/cdi')
	@ApiResponse({ status: 200, description: 'OK' })
	@ApiResponse({ status: 500, description: 'Internal Server Error' })
	async getLatestCdiRate() {
		return this.stockService.getLatestCdiRate();
	}

	@Get('macro/cdi/series')
	@ApiResponse({ status: 200, description: 'OK' })
	@ApiResponse({ status: 500, description: 'Internal Server Error' })
	async getCdiSeries(@Query('from') from?: string, @Query('to') to?: string) {
		const parsedTo = to ? new Date(to) : new Date();
		const parsedFrom = from
			? new Date(from)
			: new Date(parsedTo.getTime() - 30 * 24 * 60 * 60 * 1000);

		return this.stockService.getCdiSeries(parsedFrom, parsedTo);
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
		const wantsFundamentals = fundamental === 'true';
		const quote = await this.stockService.getNationalQuote(symbol, {
			fundamental: wantsFundamentals,
			dividends: dividends === 'true',
			range,
			interval,
		});

		if (!wantsFundamentals) {
			const results = Array.isArray(quote?.results) ? quote.results : null;
			if (!results) return quote;
			return {
				...quote,
				results: results.map((item: any) => ({ ...item, fundamentals: null })),
			};
		}

		const results = Array.isArray(quote?.results) ? quote.results : [];
		const enriched = await this.enrichWithFundamentals(results, symbol);
		return { ...quote, results: enriched };
	}

	/**
	 * Processa em lotes de FUNDAMENTALS_BATCH_SIZE, sequenciais entre lotes e
	 * paralelos dentro do lote, para limitar quantas buscas de fundamentos
	 * (Fundamentus + Yahoo) uma unica requisicao com varios simbolos dispara
	 * de uma vez.
	 */
	private async enrichWithFundamentals(
		results: any[],
		fallbackSymbol: string
	): Promise<any[]> {
		const enriched: any[] = [];
		for (
			let start = 0;
			start < results.length;
			start += FUNDAMENTALS_BATCH_SIZE
		) {
			const batch = results.slice(start, start + FUNDAMENTALS_BATCH_SIZE);
			const enrichedBatch = await Promise.all(
				batch.map(async (item: any) => {
					try {
						const fundamentals = await this.fundamentalsService.getFundamentals(
							String(item?.symbol || fallbackSymbol),
							item
						);
						return { ...item, fundamentals };
					} catch (error) {
						this.logger.warn(
							`Falha ao montar fundamentos de ${item?.symbol}: ${String(error)}`
						);
						return { ...item, fundamentals: null };
					}
				})
			);
			enriched.push(...enrichedBatch);
		}
		return enriched;
	}
}
