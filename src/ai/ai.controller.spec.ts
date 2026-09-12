import { Test, TestingModule } from '@nestjs/testing';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ChatOrchestratorService } from './orchestration/chat-orchestrator.service';
import { TrackerrScoreService } from 'src/intelligence/application/trackerr-score.service';

jest.mock('../env.ts', () => ({
	jwtSecret: 'fakeJwtSecretsdadxczxc,mfnlfnvlvnvlzmxcmv',
}));

jest.mock('../authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

const mockAiService = {
	analyzePortfolio: jest.fn(),
	simulate: jest.fn(),
	chat: jest.fn(),
};

const mockChatOrchestratorService = {
	orchestrate: jest.fn(),
};

const mockTrackerrScoreService = {
	getScoreForUser: jest.fn(),
};

describe('AiController', () => {
	let controller: AiController;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [AiController],
			providers: [
				{ provide: AiService, useValue: mockAiService },
				{
					provide: ChatOrchestratorService,
					useValue: mockChatOrchestratorService,
				},
				{
					provide: TrackerrScoreService,
					useValue: mockTrackerrScoreService,
				},
			],
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

	it('should call simulate and return simulation payload', async () => {
		const fakeSimulation = {
			total_invested: 120000,
			scenarios: {
				optimistic: 180000,
				neutral: 150000,
				pessimistic: 130000,
			},
			message: 'ok',
		};
		mockAiService.simulate.mockResolvedValue(fakeSimulation);

		const result = await controller.simulate({
			monthly_investment: 1000,
			years: 10,
			current_portfolio_value: 15000,
		});

		expect(result).toEqual(fakeSimulation);
		expect(mockAiService.simulate).toHaveBeenCalledWith(
			expect.objectContaining({
				monthly_investment: 1000,
				years: 10,
			})
		);
	});

	it('should call chat and return answer', async () => {
		const fakeChat = {
			answer: 'Com base na sua carteira, o risco está moderado.',
		};
		mockAiService.chat.mockResolvedValue(fakeChat);

		const result = await controller.chat({
			question: 'Minha carteira está muito arriscada?',
			profile_plan: 'pro',
			context: { portfolioSummary: { totalValue: 10000 } },
		});

		expect(result).toEqual(fakeChat);
		expect(mockAiService.chat).toHaveBeenCalledWith(
			expect.objectContaining({
				question: 'Minha carteira está muito arriscada?',
			})
		);
	});

	it('should call intelligent chat and return structured response', async () => {
		mockChatOrchestratorService.orchestrate.mockResolvedValue({
			intent: 'portfolio_summary',
			deterministic: true,
			route: {
				type: 'deterministic_no_llm',
				llmEligible: false,
				reason: 'rules_resolved',
			},
			data: {
				portfolioSummary: { totalValue: 1000 },
			},
			unavailable: [],
			warnings: [],
			assumptions: [],
			message: 'ok',
		});

		const response = await controller.intelligentChat(
			{ user: { userId: 'user-123' } },
			{ question: 'Resumo da carteira' }
		);

		expect(response.intent).toBe('portfolio_summary');
		expect(response.data?.portfolioSummary?.totalValue).toBe(1000);
		expect(mockChatOrchestratorService.orchestrate).toHaveBeenCalledWith(
			'user-123',
			'Resumo da carteira',
			{
				investorProfile: undefined,
				copilotFlow: undefined,
				decisionFlow: undefined,
			}
		);
	});

	it('should return safe fallback payload when orchestration fails', async () => {
		mockChatOrchestratorService.orchestrate.mockRejectedValueOnce(
			new Error('provider timeout')
		);

		const response = await controller.intelligentChat(
			{ user: { userId: 'user-123' } },
			{ question: 'quais ativos tem na minha carteira?' }
		);

		expect(response.intent).toBe('unknown');
		expect(response.deterministic).toBe(false);
		expect(response.route).toEqual(
			expect.objectContaining({
				type: 'synthesis_required',
				reason: 'insufficient_structured_data',
			})
		);
		expect(response.warnings).toContain('chat_orchestration_failed');
		expect(typeof response.message).toBe('string');
	});

	it('should return portfolio-aware list message when question asks for assets', async () => {
		mockChatOrchestratorService.orchestrate.mockResolvedValueOnce({
			intent: 'portfolio_summary',
			deterministic: true,
			route: {
				type: 'deterministic_no_llm',
				llmEligible: false,
				reason: 'rules_resolved',
			},
			question: 'listar ativos da minha carteira',
			context: {
				mentionedSymbols: [],
				ownedSymbols: ['ITUB4', 'XPLG11'],
				externalSymbols: [],
				positionsCount: 2,
			},
			cache: { key: null, hit: false, ttlSeconds: null },
			cost: {
				llmCalls: 0,
				tokenUsageEstimate: 0,
				estimatedLlmCallsAvoidedByCache: 0,
			},
			data: {
				portfolioSummary: { totalValue: 1500 },
				portfolioAssets: [
					{ symbol: 'ITUB4', allocationPct: 66.67 },
					{ symbol: 'XPLG11', allocationPct: 33.33 },
				],
			},
			unavailable: [],
			warnings: [],
			assumptions: [],
		});

		const response = await controller.intelligentChat(
			{ user: { userId: 'user-123' } },
			{ question: 'listar ativos da minha carteira' }
		);

		expect(response.intent).toBe('portfolio_summary');
		expect(response.message).toContain('2 ativo(s)');
		expect(response.message).toContain('ITUB4 (66.7%)');
		expect(response.message).toContain('XPLG11 (33.3%)');
	});

	it('should return risk message with concentration and rebalance target', async () => {
		mockChatOrchestratorService.orchestrate.mockResolvedValueOnce({
			intent: 'portfolio_risk',
			deterministic: true,
			route: {
				type: 'deterministic_no_llm',
				llmEligible: false,
				reason: 'rules_resolved',
			},
			question: 'mostre risco da minha carteira',
			context: {
				mentionedSymbols: [],
				ownedSymbols: ['ITUB4'],
				externalSymbols: [],
				positionsCount: 2,
			},
			cache: { key: null, hit: false, ttlSeconds: null },
			cost: {
				llmCalls: 0,
				tokenUsageEstimate: 0,
				estimatedLlmCallsAvoidedByCache: 0,
			},
			data: {
				portfolioRisk: {
					risk: { score: 72 },
					concentrationByAsset: [{ key: 'ITUB4', percentage: 62.4 }],
				},
				rebalanceSuggestion: {
					profile: 'conservador',
					riskScore: {
						targetReductionPct: 20,
						targetSuggested: 57.6,
					},
				},
			},
			unavailable: [],
			warnings: [],
			assumptions: [],
		});

		const response = await controller.intelligentChat(
			{ user: { userId: 'user-123' } },
			{ question: 'mostre risco da minha carteira' }
		);

		expect(response.intent).toBe('portfolio_risk');
		expect(response.message).toContain('72/100');
		expect(response.message).toContain('ITUB4 (62.4%)');
		expect(response.message).toContain('reduzir risco em 20%');
		expect(response.message).toContain('57.6');
	});

	it('should return trackerr score payload', async () => {
		mockTrackerrScoreService.getScoreForUser.mockResolvedValue({
			status: 'ok',
			overallScore: 81,
		});

		const result = await controller.trackerrScore(
			{ user: { userId: 'user-123' } },
			{ symbol: 'ITUB4' }
		);

		expect(result.status).toBe('ok');
		expect(mockTrackerrScoreService.getScoreForUser).toHaveBeenCalledWith(
			'user-123',
			'ITUB4',
			{ previousPillarScores: undefined }
		);
	});

	it('should build investment committee message with reasons and weekly priority', async () => {
		mockChatOrchestratorService.orchestrate.mockResolvedValueOnce({
			intent: 'investment_committee',
			deterministic: true,
			route: {
				type: 'deterministic_no_llm',
				llmEligible: false,
				reason: 'rules_resolved',
			},
			data: {
				investmentCommittee: {
					modelVersion: 'investment_committee_v1',
					criticalRisks: ['Concentração elevada em PETR4'],
					recommended: [
						{
							symbol: 'ITUB4',
							score: 78,
							reasons: ['ROE robusto sustentando qualidade.'],
						},
					],
					avoid: [
						{
							symbol: 'BEEF3',
							score: 39,
							reasons: ['Volatilidade de curto prazo elevada.'],
						},
					],
					objectivePlan: ['Reduzir risco agregado da carteira no curto prazo.'],
				},
			},
			unavailable: [],
			warnings: [],
			assumptions: [],
		});

		const response = await controller.intelligentChat(
			{ user: { userId: 'user-123' } },
			{ question: 'Gerar comitê de investimento semanal' }
		);

		expect(response.intent).toBe('investment_committee');
		expect(response.message).toContain('Destaque positivo: ITUB4');
		expect(response.message).toContain('Atenção: BEEF3');
		expect(response.message).toContain('Prioridade da semana');
	});
});
