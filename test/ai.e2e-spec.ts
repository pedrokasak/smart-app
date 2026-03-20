import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AiController } from '../src/ai/ai.controller';
import { AiService } from '../src/ai/ai.service';

jest.mock('src/authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: class {
		canActivate() {
			return true;
		}
	},
}));

describe('AiController (e2e)', () => {
	let app: INestApplication;

	const aiServiceMock = {
		analyzePortfolio: jest.fn(),
		simulate: jest.fn(),
	};

	beforeEach(async () => {
		const moduleFixture: TestingModule = await Test.createTestingModule({
			controllers: [AiController],
			providers: [{ provide: AiService, useValue: aiServiceMock }],
		}).compile();

		app = moduleFixture.createNestApplication();
		await app.init();
	});

	afterEach(async () => {
		jest.clearAllMocks();
		await app.close();
	});

	it('/ai/analyze (POST)', async () => {
		aiServiceMock.analyzePortfolio.mockResolvedValue({
			portfolio_assessment: 'ok',
		});

		await request(app.getHttpServer())
			.post('/ai/analyze')
			.send({
				user_id: 'e2e-user',
				profile_plan: 'pro',
				portfolio: { id: 'p1', name: 'Main', cpf: '', assets: [], total_value: 0, plan: 'pro' },
				risk_profile: 'moderate',
			})
			.expect(200)
			.expect({ portfolio_assessment: 'ok' });

		expect(aiServiceMock.analyzePortfolio).toHaveBeenCalledWith(
			expect.objectContaining({ user_id: 'e2e-user' })
		);
	});

	it('/ai/simulate (POST)', async () => {
		aiServiceMock.simulate.mockResolvedValue({
			scenarios: { optimistic: 100, neutral: 80, pessimistic: 60 },
		});

		await request(app.getHttpServer())
			.post('/ai/simulate')
			.send({
				monthly_investment: 500,
				years: 10,
				current_portfolio_value: 10000,
			})
			.expect(200)
			.expect({
				scenarios: { optimistic: 100, neutral: 80, pessimistic: 60 },
			});
	});
});
