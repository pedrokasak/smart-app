import { Test, TestingModule } from '@nestjs/testing';
import { StockService } from './stocks.service';
import { TwelveDataAdapter } from 'src/stocks/adapter/twelveDataApi';
import { BrapiAdapter } from 'src/stocks/adapter/brapiDataApi';

describe('TwelveDataService', () => {
	let service: StockService;
	let brapi: BrapiAdapter;
	let twelveData: TwelveDataAdapter;

	beforeEach(async () => {
		const brapiMock = {
			listAllStocks: jest.fn(),
			getStockQuote: jest.fn(),
		};
		const twelveDataMock = {
			getStockQuote: jest.fn(),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				StockService,
				{ provide: BrapiAdapter, useValue: brapiMock },
				{ provide: TwelveDataAdapter, useValue: twelveDataMock },
			],
		}).compile();

		service = module.get<StockService>(StockService);
		brapi = module.get<BrapiAdapter>(BrapiAdapter);
		twelveData = module.get<TwelveDataAdapter>(TwelveDataAdapter);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});

	describe('getAllNational', () => {
		it('should call brapi.listAllStocks', async () => {
			(brapi.listAllStocks as jest.Mock).mockResolvedValue([
				'stock1',
				'stock2',
			]);
			const result = await service.getAllNational();
			expect(brapi.listAllStocks).toHaveBeenCalled();
			expect(result).toEqual(['stock1', 'stock2']);
		});
	});

	describe('getNationalQuote', () => {
		it('should call brapi.getStockQuote with formatted symbol', async () => {
			(brapi.getStockQuote as jest.Mock).mockResolvedValue({ price: 10 });
			const result = await service.getNationalQuote(' petr4.sa ');
			expect(brapi.getStockQuote).toHaveBeenCalledWith('PETR4.SA');
			expect(result).toEqual({ price: 10 });
		});
	});

	describe('getStockQuoteGlobal', () => {
		it('should call twelveData.getStockQuote with symbol', async () => {
			(twelveData.getStockQuote as jest.Mock).mockResolvedValue({ price: 20 });
			const result = await service.getStockQuoteGlobal('AAPL');
			expect(twelveData.getStockQuote).toHaveBeenCalledWith('AAPL');
			expect(result).toEqual({ price: 20 });
		});
	});
});
