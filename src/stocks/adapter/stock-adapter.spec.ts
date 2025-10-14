import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { BrapiAdapter } from 'src/stocks/adapter/brapiDataApi';
import { TwelveDataAdapter } from 'src/stocks/adapter/twelveDataApi';

jest.mock('../../env.ts', () => ({
	jwtSecret: 'fakeJwtSecretsdadxczxcmfnlfnvlvnvlzmxcmv',
}));

jest.mock('../../authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

jest.mock('../../env.ts', () => ({
	twelveDataApiKey: 'fake-api-key',
	brapiApiKey: 'fake-brapi-key',
}));

describe('Stock API Adapters', () => {
	let httpService: HttpService;
	let brapiAdapter: BrapiAdapter;
	let twelveDataAdapter: TwelveDataAdapter;

	beforeEach(async () => {
		const mockHttpService = {
			get: jest.fn(),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				BrapiAdapter,
				TwelveDataAdapter,
				{ provide: HttpService, useValue: mockHttpService },
			],
		}).compile();

		httpService = module.get<HttpService>(HttpService);
		brapiAdapter = module.get<BrapiAdapter>(BrapiAdapter);
		twelveDataAdapter = module.get<TwelveDataAdapter>(TwelveDataAdapter);
	});

	describe('BrapiAdapter', () => {
		it('Should be return data from API simulated', async () => {
			const mockResponse = {
				data: { results: [{ symbol: 'PETR4', price: 38.5 }] },
			};
			(httpService.get as jest.Mock).mockReturnValue(of(mockResponse));

			const result = await brapiAdapter.getStockQuote('PETR4');
			expect(result).toEqual(mockResponse.data);
			expect(httpService.get).toHaveBeenCalled();
		});
	});

	describe('TwelveDataAdapter', () => {
		it('deve retornar dados da API simulada', async () => {
			const mockResponse = { data: { symbol: 'AAPL', price: 190.2 } };
			(httpService.get as jest.Mock).mockReturnValue(of(mockResponse));

			const result = await twelveDataAdapter.getStockQuote('AAPL');
			expect(result).toEqual(mockResponse.data);
			expect(httpService.get).toHaveBeenCalled();
		});
	});
});
