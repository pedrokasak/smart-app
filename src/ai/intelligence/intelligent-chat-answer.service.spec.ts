import { NotFoundException } from '@nestjs/common';
import { PORTFOLIO_FILTER_IGNORED } from '../orchestration/chat-orchestrator.service';
import { IntelligentChatAnswerService } from './intelligent-chat-answer.service';

const part = (warnings: string[] = []) => ({
	intent: 'dividends_received',
	deterministic: true,
	route: { type: 'deterministic_no_llm', reason: 'rules_resolved' },
	data: {},
	unavailable: [],
	warnings,
	assumptions: [],
	context: { positionsCount: 1 },
});

function setup(warnings: string[] = []) {
	const router = {
		answer: jest.fn().mockResolvedValue({
			parts: [part(warnings)],
			routing: { mode: 'regex' },
		}),
	};
	const didactic = {
		explain: jest.fn().mockResolvedValue([{ message: 'Você recebeu R$ 70.' }]),
	};
	const portfolios = {
		getUserPortfolios: jest
			.fn()
			.mockResolvedValue([{ _id: 'wallet-a' }, { _id: 'wallet-b' }]),
	};
	const service = new IntelligentChatAnswerService(
		router as any,
		didactic as any,
		portfolios as any
	);
	return { service, router, portfolios };
}

describe('IntelligentChatAnswerService: filtro por carteira (ADR-007, decisão 10)', () => {
	it('sem carteira, responde sobre todas e não consulta as carteiras', async () => {
		const { service, router, portfolios } = setup();
		const response = await service.answer('u1', { question: 'Quanto recebi?' });

		expect(portfolios.getUserPortfolios).not.toHaveBeenCalled();
		expect(router.answer.mock.calls[0][2]).not.toHaveProperty('portfolioId');
		expect(response.portfolioId).toBeNull();
	});

	it('com carteira do usuário, repassa o filtro e devolve a carteira usada', async () => {
		const { service, router } = setup();
		const response = await service.answer('u1', {
			question: 'Quanto recebi?',
			portfolioId: 'wallet-b',
		});

		expect(router.answer.mock.calls[0][2]).toEqual(
			expect.objectContaining({ portfolioId: 'wallet-b' })
		);
		expect(response.portfolioId).toBe('wallet-b');
		expect(response.message).toBe('Você recebeu R$ 70.');
	});

	it('carteira de outro usuário ou inexistente responde 404, sem chamar o orquestrador', async () => {
		const { service, router } = setup();

		await expect(
			service.answer('u1', {
				question: 'Quanto recebi?',
				portfolioId: 'wallet-de-outro',
			})
		).rejects.toBeInstanceOf(NotFoundException);
		expect(router.answer).not.toHaveBeenCalled();
	});

	it('quando a resposta considerou todas as carteiras, diz isso no texto', async () => {
		const { service } = setup([PORTFOLIO_FILTER_IGNORED]);
		const response = await service.answer('u1', {
			question: 'Quanto recebi?',
			portfolioId: 'wallet-a',
		});

		expect(response.message).toBe(
			'Você recebeu R$ 70.\n\nEsta resposta considera todas as suas carteiras.'
		);
	});
});

describe('IntelligentChatAnswerService: contexto da conversa (ADR-007, fase 2)', () => {
	function setupWithConversation(previous: string | string[] | null) {
		const router = {
			answer: jest
				.fn()
				.mockResolvedValue({ parts: [part()], routing: { mode: 'regex' } }),
		};
		const didactic = {
			explain: jest.fn().mockResolvedValue([{ message: 'ok' }]),
		};
		const portfolios = { getUserPortfolios: jest.fn().mockResolvedValue([]) };
		const conversations = {
			ensureOwned: jest.fn().mockResolvedValue(undefined),
		};
		const history = {
			recentUserQuestions: jest
				.fn()
				.mockResolvedValue(
					previous === null
						? []
						: Array.isArray(previous)
							? previous
							: [previous]
				),
		};
		const service = new IntelligentChatAnswerService(
			router as any,
			didactic as any,
			portfolios as any,
			conversations as any,
			history as any
		);
		return { service, router, conversations };
	}

	it('pergunta de seguimento usa a anterior da mesma conversa', async () => {
		const { service, router, conversations } = setupWithConversation(
			'Quanto a PETR4 pagou de dividendos?'
		);
		const response = await service.answer('u1', {
			question: 'e a VALE3?',
			conversationId: 'conv-1',
		});

		expect(conversations.ensureOwned).toHaveBeenCalledWith('u1', 'conv-1');
		expect(router.answer.mock.calls[0][1]).toBe(
			'Quanto a VALE3 pagou de dividendos?'
		);
		expect(response.resolvedQuestion).toBe(
			'Quanto a VALE3 pagou de dividendos?'
		);
	});

	it('seguimento de seguimento usa o contexto resolvido em cadeia', async () => {
		const { service, router } = setupWithConversation([
			'Quanto a PETR4 pagou de dividendos?',
			'e a VALE3?',
		]);
		await service.answer('u1', {
			question: 'e a ITUB4?',
			conversationId: 'conv-1',
		});

		expect(router.answer.mock.calls[0][1]).toBe(
			'Quanto a ITUB4 pagou de dividendos?'
		);
	});

	it('conversa de outro usuário responde 404 sem chamar o orquestrador', async () => {
		const { service, router, conversations } = setupWithConversation(null);
		conversations.ensureOwned.mockRejectedValue(
			new NotFoundException('conversation_not_found')
		);

		await expect(
			service.answer('u1', { question: 'oi', conversationId: 'conv-x' })
		).rejects.toBeInstanceOf(NotFoundException);
		expect(router.answer).not.toHaveBeenCalled();
	});

	it('pergunta completa vai como veio, sem resolvedQuestion', async () => {
		const { service, router } = setupWithConversation('Quanto a PETR4 pagou?');
		const response = await service.answer('u1', {
			question: 'Como está minha carteira?',
			conversationId: 'conv-1',
		});

		expect(router.answer.mock.calls[0][1]).toBe('Como está minha carteira?');
		expect(response).not.toHaveProperty('resolvedQuestion');
	});
});

describe('IntelligentChatAnswerService: projeção de proventos (melhoria 1dfh60pm56k)', () => {
	function answerFor(intent: string, data: Record<string, unknown>) {
		const router = {
			answer: jest.fn().mockResolvedValue({
				parts: [{ ...part(), intent, data }],
				routing: { mode: 'regex' },
			}),
		};
		// Sem compositor didático para a parte: vale o texto do serviço.
		const didactic = { explain: jest.fn().mockResolvedValue([{}]) };
		const service = new IntelligentChatAnswerService(
			router as any,
			didactic as any,
			{ getUserPortfolios: jest.fn() } as any
		);
		return service.answer('u1', {
			question: 'Como recebo dividendos todo mês?',
		});
	}

	const projection = (overrides: Record<string, unknown> = {}) => ({
		modelVersion: 'deterministic_v1',
		projectedAnnualIncome: 14400,
		projectedMonthlyIncome: 1200,
		projectedYieldOnPortfolioPct: 7.2,
		coverage: {
			positionsWithData: 5,
			positionsWithoutData: 0,
			dataCoveragePct: 100,
		},
		byAssetClass: [
			{
				assetClass: 'equities',
				annualIncome: 5040,
				monthlyIncome: 420,
				sharePct: 35,
			},
			{
				assetClass: 'real_estate',
				annualIncome: 9360,
				monthlyIncome: 780,
				sharePct: 65,
			},
		],
		...overrides,
	});

	it('diz a renda projetada, de onde vem e quem paga todo mês, sem prometer painel', async () => {
		const response = await answerFor('dividend_projection', {
			dividendProjection: projection(),
		});

		// Reais inteiros: com centavos a voz leria "e zero centavos".
		expect(response.message).toMatch(/cerca de R\$\s?1\.200 por mês/);
		expect(response.message).toMatch(/R\$\s?14\.400 em 12 meses/);
		expect(response.message).toContain('yield de 7,2%');
		expect(response.message).toContain('A maior parte vem de FIIs (65,0%)');
		expect(response.message).toContain('FIIs costumam pagar todo mês');
		expect(response.message).not.toMatch(/painel/i);
	});

	it('com cobertura parcial, avisa quantos ativos ficaram de fora', async () => {
		const response = await answerFor('dividend_projection', {
			dividendProjection: projection({
				coverage: {
					positionsWithData: 3,
					positionsWithoutData: 2,
					dataCoveragePct: 60,
				},
			}),
		});

		expect(response.message).toContain(
			'2 de 5 ativos ficaram de fora por não terem histórico de proventos'
		);
	});

	it('um ativo de fora usa o singular', async () => {
		const response = await answerFor('dividend_projection', {
			dividendProjection: projection({
				coverage: {
					positionsWithData: 4,
					positionsWithoutData: 1,
					dataCoveragePct: 80,
				},
			}),
		});

		expect(response.message).toContain(
			'1 de 5 ativos ficou de fora por não ter histórico de proventos'
		);
	});

	it('sem divisão por classe nem yield, não inventa classe nem "NaN%"', async () => {
		const response = await answerFor('dividend_projection', {
			dividendProjection: projection({
				byAssetClass: [],
				projectedYieldOnPortfolioPct: undefined,
			}),
		});

		expect(response.message).not.toContain('A maior parte vem de');
		expect(response.message).not.toContain('NaN');
		expect(response.message).toMatch(/R\$\s?14\.400 em 12 meses\)\./);
	});

	it('renda mensal abaixo de R$ 10 mantém os centavos', async () => {
		const response = await answerFor('dividend_projection', {
			dividendProjection: projection({
				projectedMonthlyIncome: 4.5,
				projectedAnnualIncome: 54,
			}),
		});

		expect(response.message).toContain('cerca de R$ 4,50 por mês');
	});

	it('anual ausente não vira "R$ 0 em 12 meses"', async () => {
		const response = await answerFor('dividend_projection', {
			dividendProjection: projection({ projectedAnnualIncome: undefined }),
		});

		expect(response.message).toBe(
			'Ainda não tenho histórico de proventos dos seus ativos para projetar a renda.'
		);
	});

	it('sem histórico de proventos, diz isso em vez de projetar zero', async () => {
		const response = await answerFor('dividend_projection', {
			dividendProjection: projection({
				projectedAnnualIncome: 0,
				projectedMonthlyIncome: 0,
				coverage: {
					positionsWithData: 0,
					positionsWithoutData: 4,
					dataCoveragePct: 0,
				},
				byAssetClass: [],
			}),
		});

		expect(response.message).toBe(
			'Ainda não tenho histórico de proventos dos seus ativos para projetar a renda.'
		);
	});

	it('intenção sem texto próprio não promete painel', async () => {
		const response = await answerFor('future_scenario', {});

		expect(response.message).not.toMatch(/painel/i);
		expect(response.message).toBe(
			'Consultei os dados da sua carteira, mas ainda não consigo resumir essa análise em texto.'
		);
	});
});
