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
