import { Test, TestingModule } from '@nestjs/testing';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

jest.mock('../env.ts', () => ({
	jwtSecret: 'fakeJwtSecretsdadxczxc,mfnlfnvlvnvlzmxcmv',
}));

jest.mock('../authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

const mockAiService = {
	analyzePortfolio: jest.fn(),
};

describe('AiController', () => {
	let controller: AiController;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [AiController],
			providers: [{ provide: AiService, useValue: mockAiService }],
		}).compile();

		controller = module.get<AiController>(AiController);
	});

	afterEach(() => jest.clearAllMocks());

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});

	it('should call analyzePortfolio with userId from JWT', async () => {
		const fakeResponse = {
			plan: 'free',
			stock_scores: {},
			fii_scores: {},
			timestamp: new Date().toISOString(),
		};
		mockAiService.analyzePortfolio.mockResolvedValue(fakeResponse);

		const req = { user: { userId: 'user-123' } };
		const body = {
			profile_plan: 'free',
			risk_profile: 'moderate',
			portfolio: {
				id: 'port-1',
				name: 'My Portfolio',
				cpf: '000.000.000-00',
				assets: [],
				total_value: 0,
				plan: 'free',
			},
			address: { city: 'São Paulo', state: 'SP', country: 'Brazil' },
			preferences: { language: 'pt-BR', theme: 'dark' },
		};

		const result = await controller.analyze(req, body);

		expect(result).toEqual(fakeResponse);
		expect(mockAiService.analyzePortfolio).toHaveBeenCalledWith(
			expect.objectContaining({ user_id: 'user-123' })
		);
	});

	it('should use user_id from body if provided', async () => {
		const fakeResponse = {
			plan: 'premium',
			stock_scores: {},
			fii_scores: {},
			timestamp: new Date().toISOString(),
		};
		mockAiService.analyzePortfolio.mockResolvedValue(fakeResponse);

		const req = { user: { userId: 'from-jwt' } };
		const body = {
			user_id: 'from-body',
			profile_plan: 'premium',
			risk_profile: 'aggressive',
			portfolio: {
				id: 'port-2',
				name: 'Premium Portfolio',
				cpf: '000.000.000-00',
				assets: [],
				total_value: 5000,
				plan: 'premium',
			},
			address: {},
			preferences: {},
		};

		const result = await controller.analyze(req, body);
		expect(result).toEqual(fakeResponse);
	});
});
