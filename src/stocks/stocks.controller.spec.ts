import { Test, TestingModule } from '@nestjs/testing';
import { StocksController } from './stocks.controller';
import { StockService } from 'src/stocks/stocks.service';

jest.mock('../env.ts', () => ({
	jwtSecret: 'fakeJwtSecretsdadxczxc,mfnlfnvlvnvlzmxcmv',
}));

jest.mock('../authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

describe('StocksController', () => {
	let controller: StocksController;
	let service: StockService;

	const mockStockService = {
		getAllNational: jest.fn(),
		getStockQuoteGlobal: jest.fn(),
		getNationalQuote: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [StocksController],
			providers: [{ provide: StockService, useValue: mockStockService }],
		}).compile();

		controller = module.get<StocksController>(StocksController);
		service = module.get<StockService>(StockService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('getAllNational', () => {
		it('should call stockService.getAllNational and return data', async () => {
			const mockData = [{ symbol: 'PETR4' }];
			mockStockService.getAllNational.mockResolvedValue(mockData);

			const result = await controller.getAllNational();

			expect(service.getAllNational).toHaveBeenCalled();
			expect(result).toEqual(mockData);
		});
	});

	describe('getStockQuoteGlobal', () => {
		it('should return error if symbol is not provided', async () => {
			const result = await controller.getStockQuoteGlobal('');
			expect(result).toEqual({ error: 'O parâmetro symbol é obrigatório' });
			expect(service.getStockQuoteGlobal).not.toHaveBeenCalled();
		});

		it('should call stockService.getStockQuoteGlobal with symbol', async () => {
			const mockQuote = { symbol: 'AAPL', price: 200 };
			mockStockService.getStockQuoteGlobal.mockResolvedValue(mockQuote);

			const result = await controller.getStockQuoteGlobal('AAPL');

			expect(service.getStockQuoteGlobal).toHaveBeenCalledWith('AAPL');
			expect(result).toEqual(mockQuote);
		});
	});

	describe('getStockQuoteNational', () => {
		it('should return error if symbol is not provided', async () => {
			const result = await controller.getStockQuoteNational('');
			expect(result).toEqual({ error: 'O parâmetro symbol é obrigatório' });
			expect(service.getNationalQuote).not.toHaveBeenCalled();
		});

		it('should call stockService.getNationalQuote with symbol', async () => {
			const mockQuote = { symbol: 'PETR4', price: 35 };
			mockStockService.getNationalQuote.mockResolvedValue(mockQuote);

			const result = await controller.getStockQuoteNational('PETR4');

			expect(service.getNationalQuote).toHaveBeenCalledWith('PETR4');
			expect(result).toEqual(mockQuote);
		});
	});
});
