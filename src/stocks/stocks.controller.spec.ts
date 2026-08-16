import { Test, TestingModule } from '@nestjs/testing';
import { StocksController, FUNDAMENTALS_BATCH_SIZE } from './stocks.controller';
import { StockService } from 'src/stocks/stocks.service';
import { FundamentalsService } from 'src/stocks/fundamentals/fundamentals.service';

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

	const mockFundamentalsService = {
		getFundamentals: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [StocksController],
			providers: [
				{ provide: StockService, useValue: mockStockService },
				{ provide: FundamentalsService, useValue: mockFundamentalsService },
			],
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
			const mockQuote = {
				results: [{ symbol: 'PETR4', price: 35 }],
			};
			mockStockService.getNationalQuote.mockResolvedValue(mockQuote);

			const result = await controller.getStockQuoteNational('PETR4');

			expect(service.getNationalQuote).toHaveBeenCalledWith('PETR4', {
				fundamental: false,
				dividends: false,
				range: undefined,
				interval: undefined,
			});
			expect(result).toEqual({
				results: [{ symbol: 'PETR4', price: 35, fundamentals: null }],
			});
		});
	});

	describe('national/quote com fundamentos', () => {
		it('anexa fundamentals ao resultado sem remover os campos atuais', async () => {
			const fundamentals = {
				symbol: 'WEGE3',
				sector: 'Máquinas e Equipamentos',
				mixed: false,
				values: {
					roic: { status: 'ok', value: 24.3, source: 'fundamentus' },
				},
			};
			mockStockService.getNationalQuote.mockResolvedValue({
				results: [{ symbol: 'WEGE3', regularMarketPrice: 47.5 }],
			});
			mockFundamentalsService.getFundamentals.mockResolvedValue(fundamentals);

			const response = await controller.getStockQuoteNational('WEGE3', 'true');

			expect(response.results[0].regularMarketPrice).toBe(47.5);
			expect(response.results[0].fundamentals).toEqual(fundamentals);
		});

		it('devolve a cotacao mesmo quando os fundamentos falham', async () => {
			mockStockService.getNationalQuote.mockResolvedValue({
				results: [{ symbol: 'WEGE3', regularMarketPrice: 47.5 }],
			});
			mockFundamentalsService.getFundamentals.mockRejectedValue(
				new Error('fonte fora')
			);

			const response = await controller.getStockQuoteNational('WEGE3', 'true');

			expect(response.results[0].regularMarketPrice).toBe(47.5);
			expect(response.results[0].fundamentals).toBeNull();
		});

		it('nao chama getFundamentals quando o flag fundamental esta ausente', async () => {
			mockStockService.getNationalQuote.mockResolvedValue({
				results: [{ symbol: 'WEGE3', regularMarketPrice: 47.5 }],
			});

			const response = await controller.getStockQuoteNational('WEGE3');

			expect(mockFundamentalsService.getFundamentals).not.toHaveBeenCalled();
			expect(response.results[0].regularMarketPrice).toBe(47.5);
			expect(response.results[0].fundamentals).toBeNull();
		});

		it('nao chama getFundamentals quando o flag fundamental e "false"', async () => {
			mockStockService.getNationalQuote.mockResolvedValue({
				results: [{ symbol: 'WEGE3', regularMarketPrice: 47.5 }],
			});

			const response = await controller.getStockQuoteNational('WEGE3', 'false');

			expect(mockFundamentalsService.getFundamentals).not.toHaveBeenCalled();
			expect(response.results[0].fundamentals).toBeNull();
		});

		it('chama getFundamentals quando o flag fundamental e "true"', async () => {
			mockStockService.getNationalQuote.mockResolvedValue({
				results: [{ symbol: 'WEGE3', regularMarketPrice: 47.5 }],
			});
			mockFundamentalsService.getFundamentals.mockResolvedValue({
				symbol: 'WEGE3',
			});

			await controller.getStockQuoteNational('WEGE3', 'true');

			expect(mockFundamentalsService.getFundamentals).toHaveBeenCalledTimes(1);
			expect(mockFundamentalsService.getFundamentals).toHaveBeenCalledWith(
				'WEGE3',
				expect.objectContaining({ symbol: 'WEGE3' })
			);
		});

		it('processa o enriquecimento em lotes limitados a FUNDAMENTALS_BATCH_SIZE por vez', async () => {
			const totalItems = FUNDAMENTALS_BATCH_SIZE * 2 + 2;
			const items = Array.from({ length: totalItems }, (_, index) => ({
				symbol: `S${index}`,
				regularMarketPrice: index,
			}));
			mockStockService.getNationalQuote.mockResolvedValue({ results: items });

			const callOrder: string[] = [];
			const pendingResolvers: Array<() => void> = [];
			mockFundamentalsService.getFundamentals.mockImplementation(
				(sym: string) => {
					callOrder.push(sym);
					return new Promise((resolve) => {
						pendingResolvers.push(() => resolve({ symbol: sym }));
					});
				}
			);

			const responsePromise = controller.getStockQuoteNational(
				items[0].symbol,
				'true'
			);

			// deixa as microtasks do primeiro lote encadearem antes de inspecionar
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();

			expect(callOrder.length).toBe(FUNDAMENTALS_BATCH_SIZE);

			// resolve o primeiro lote e libera o segundo
			pendingResolvers.splice(0).forEach((resolve) => resolve());
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();

			expect(callOrder.length).toBe(FUNDAMENTALS_BATCH_SIZE * 2);

			// resolve o segundo lote e libera o restante
			pendingResolvers.splice(0).forEach((resolve) => resolve());
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();

			expect(callOrder.length).toBe(totalItems);

			pendingResolvers.splice(0).forEach((resolve) => resolve());

			const response = await responsePromise;
			expect(response.results).toHaveLength(totalItems);
			expect(
				response.results.every((item: any) => item.fundamentals !== null)
			).toBe(true);
		});
	});
});
