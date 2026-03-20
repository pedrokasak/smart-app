import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { HttpService } from '@nestjs/axios';
import { InternalServerErrorException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';

const mockHttpService = {
	post: jest.fn(),
};

describe('AiService', () => {
	let service: AiService;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AiService,
				{ provide: HttpService, useValue: mockHttpService },
			],
		}).compile();

		service = module.get<AiService>(AiService);
	});

	afterEach(() => jest.clearAllMocks());

	it('should be defined', () => {
		expect(service).toBeDefined();
	});

	it('should call trakker-ia and return the response', async () => {
		const fakeData = {
			plan: 'free',
			stock_scores: {
				VALE3: {
					score: 85,
					rating: 'Excelente',
					details: [],
					recommendation: 'COMPRA',
				},
			},
			fii_scores: {},
			timestamp: new Date().toISOString(),
		};

		const axiosResponse: AxiosResponse = {
			data: fakeData,
			status: 200,
			statusText: 'OK',
			headers: {},
			config: {} as any,
		};

		mockHttpService.post.mockReturnValue(of(axiosResponse));

		const result = await service.analyzePortfolio({
			user_id: 'u1',
			profile_plan: 'free',
		});
		expect(result).toEqual(fakeData);
		expect(mockHttpService.post).toHaveBeenCalledWith(
			expect.stringContaining('/api/hybrid-analysis'),
			expect.any(Object),
			expect.any(Object)
		);
	});

	it('should throw InternalServerErrorException on trakker-ia failure', async () => {
		mockHttpService.post.mockReturnValue(
			throwError(() => ({
				message: 'Connection refused',
				response: { data: { detail: 'Service down' } },
			}))
		);

		await expect(service.analyzePortfolio({})).rejects.toThrow(
			InternalServerErrorException
		);
	});

	it('should call simulate endpoint and return simulation data', async () => {
		const fakeData = {
			total_invested: 20000,
			scenarios: {
				optimistic: 35000,
				neutral: 30000,
				pessimistic: 25000,
			},
			message: 'ok',
		};

		const axiosResponse: AxiosResponse = {
			data: fakeData,
			status: 200,
			statusText: 'OK',
			headers: {},
			config: {} as any,
		};

		mockHttpService.post.mockReturnValue(of(axiosResponse));

		const result = await service.simulate({
			monthly_investment: 500,
			years: 5,
			current_portfolio_value: 10000,
		});

		expect(result).toEqual(fakeData);
		expect(mockHttpService.post).toHaveBeenCalledWith(
			expect.stringContaining('/api/simulate'),
			expect.any(Object),
			expect.any(Object)
		);
	});

	it('should throw InternalServerErrorException on simulate failure', async () => {
		mockHttpService.post.mockReturnValue(
			throwError(() => ({
				message: 'Connection refused',
				response: { data: { detail: 'Simulation service down' } },
			}))
		);

		await expect(service.simulate({})).rejects.toThrow(
			InternalServerErrorException
		);
	});
});
