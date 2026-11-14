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
	function setupWithConversation(previous: string | null) {
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
		const history = { lastUserQuestion: jest.fn().mockResolvedValue(previous) };
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
