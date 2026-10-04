import { ChatCostObserverPort } from 'src/ai/orchestration/chat-cost-observer.port';
import { ChatOrchestratorService } from 'src/ai/orchestration/chat-orchestrator.service';
import {
	ChatOrchestratorIntent,
	ChatOrchestratorResponse,
} from 'src/ai/orchestration/chat-orchestrator.types';
import { ChatToolPlannerPort } from 'src/ai/orchestration/tool-routing/chat-tool-planner.port';
import { ChatToolRouterConfig } from 'src/ai/orchestration/tool-routing/chat-tool-router.config';
import { ChatToolRouterService } from 'src/ai/orchestration/tool-routing/chat-tool-router.service';
import {
	FREE_ACCESS_LEVEL,
	PRO_ACCESS_LEVEL,
	UserPlanResolverPort,
} from 'src/subscription/application/user-plan.types';

function response(
	intent: ChatOrchestratorIntent,
	data: ChatOrchestratorResponse['data'] = {}
): ChatOrchestratorResponse {
	return {
		intent,
		deterministic: true,
		route: {
			type:
				intent === 'unknown' ? 'synthesis_required' : 'deterministic_no_llm',
			llmEligible: intent === 'unknown',
			reason: intent === 'unknown' ? 'ambiguous_question' : 'rules_resolved',
		},
		cache: { key: null, hit: false, ttlSeconds: null },
		cost: {
			llmCalls: 0,
			tokenUsageEstimate: 0,
			estimatedLlmCallsAvoidedByCache: 0,
		},
		question: 'q',
		context: {
			mentionedSymbols: [],
			ownedSymbols: [],
			externalSymbols: [],
			positionsCount: 2,
		},
		data,
		unavailable: [],
		warnings: [],
		assumptions: [],
	};
}

describe('ChatToolRouterService (TRA-241)', () => {
	let orchestrator: { orchestrate: jest.Mock };
	let planner: { plan: jest.Mock };
	let plans: jest.Mocked<UserPlanResolverPort>;
	let costObserver: { record: jest.Mock; recordToolRouting: jest.Mock };
	let config: ChatToolRouterConfig;

	const makeRouter = () =>
		new ChatToolRouterService(
			orchestrator as unknown as ChatOrchestratorService,
			planner as unknown as ChatToolPlannerPort,
			plans,
			costObserver as unknown as ChatCostObserverPort,
			config
		);

	const plan = (
		calls: { intent: ChatOrchestratorIntent; tickers?: string[] }[]
	) => ({
		calls: calls.map((call) => ({
			intent: call.intent,
			tickers: call.tickers ?? [],
		})),
		provider: 'openrouter',
		inputTokens: 410,
		outputTokens: 22,
		reason: calls.length ? null : 'no_tool',
	});

	beforeEach(() => {
		orchestrator = {
			orchestrate: jest.fn().mockResolvedValue(response('unknown')),
		};
		planner = {
			plan: jest.fn().mockResolvedValue(plan([{ intent: 'portfolio_risk' }])),
		};
		plans = {
			resolve: jest.fn(),
			resolveWithCapabilities: jest.fn().mockResolvedValue({
				tier: PRO_ACCESS_LEVEL,
				capabilities: [],
				capabilitiesKnown: null,
			}),
		};
		costObserver = { record: jest.fn(), recordToolRouting: jest.fn() };
		config = { enabled: true, maxCalls: 3 };
	});

	// Aceite: pergunta que o regex resolve continua sem LLM.
	it('never calls the LLM for a question the regex resolves', async () => {
		orchestrator.orchestrate.mockResolvedValue(response('portfolio_summary'));

		const answer = await makeRouter().answer('u1', 'Resumo da minha carteira');

		expect(answer.routing.mode).toBe('regex');
		expect(planner.plan).not.toHaveBeenCalled();
		expect(costObserver.recordToolRouting).not.toHaveBeenCalled();
	});

	it('answers an unknown question through the chosen tool', async () => {
		orchestrator.orchestrate
			.mockResolvedValueOnce(response('unknown'))
			.mockResolvedValueOnce(response('portfolio_risk'));

		const answer = await makeRouter().answer(
			'u1',
			'Estou exposto demais a bancos?'
		);

		expect(answer.parts.map((p) => p.intent)).toEqual(['portfolio_risk']);
		expect(answer.routing).toEqual({
			mode: 'tool_calling',
			trigger: 'unknown',
			intents: ['portfolio_risk'],
		});
		expect(orchestrator.orchestrate).toHaveBeenLastCalledWith(
			'u1',
			'Estou exposto demais a bancos?',
			{ plannedCall: { intent: 'portfolio_risk', symbols: [] } }
		);
	});

	it('answers each part of a question with two requests, reusing the regex one', async () => {
		orchestrator.orchestrate
			.mockResolvedValueOnce(response('asset_comparison'))
			.mockResolvedValueOnce(response('portfolio_risk'));
		planner.plan.mockResolvedValue(
			plan([
				{ intent: 'asset_comparison', tickers: ['PETR4', 'VALE3'] },
				{ intent: 'portfolio_risk' },
			])
		);

		const answer = await makeRouter().answer(
			'u1',
			'Compare PETR4 e VALE3 e diga o impacto no meu risco'
		);

		expect(answer.parts.map((p) => p.intent)).toEqual([
			'asset_comparison',
			'portfolio_risk',
		]);
		expect(answer.routing.trigger).toBe('multi_intent');
		expect(orchestrator.orchestrate).toHaveBeenCalledTimes(2);
	});

	it('records cost and latency of every routed question', async () => {
		orchestrator.orchestrate
			.mockResolvedValueOnce(response('unknown'))
			.mockResolvedValueOnce(response('portfolio_risk'));

		await makeRouter().answer('u1', 'Estou exposto demais a bancos?');

		expect(costObserver.recordToolRouting).toHaveBeenCalledWith(
			expect.objectContaining({
				trigger: 'unknown',
				outcome: 'routed',
				calls: 1,
				intents: ['portfolio_risk'],
				provider: 'openrouter',
				inputTokens: 410,
				outputTokens: 22,
				latencyMs: expect.any(Number),
			})
		);
	});

	describe('falls back to the regex answer', () => {
		it('while switched off', async () => {
			config.enabled = false;

			const answer = await makeRouter().answer('u1', 'Estou exposto demais?');

			expect(answer.routing.mode).toBe('regex');
			expect(planner.plan).not.toHaveBeenCalled();
		});

		it('for a plan without ai.rag', async () => {
			plans.resolveWithCapabilities.mockResolvedValue({
				tier: FREE_ACCESS_LEVEL,
				capabilities: [],
				capabilitiesKnown: null,
			});

			await makeRouter().answer('u1', 'Estou exposto demais?');

			expect(planner.plan).not.toHaveBeenCalled();
		});

		it('for small talk', async () => {
			await makeRouter().answer('u1', 'oi, tudo bem?');

			expect(planner.plan).not.toHaveBeenCalled();
		});

		it('for Copilot flows, which already carry the intent', async () => {
			await makeRouter().answer('u1', 'Estou exposto demais?', {
				copilotFlow: 'sell_asset',
			});

			expect(planner.plan).not.toHaveBeenCalled();
		});

		it('when the planner fails, and records it', async () => {
			planner.plan.mockRejectedValue(new Error('timeout of 8000ms exceeded'));

			const answer = await makeRouter().answer('u1', 'Estou exposto demais?');

			expect(answer.parts.map((p) => p.intent)).toEqual(['unknown']);
			expect(costObserver.recordToolRouting).toHaveBeenCalledWith(
				expect.objectContaining({ outcome: 'failed' })
			);
		});

		it('when no tool fits', async () => {
			planner.plan.mockResolvedValue(plan([]));

			const answer = await makeRouter().answer(
				'u1',
				'Qual a capital da França?'
			);

			expect(answer.routing.mode).toBe('regex');
			expect(costObserver.recordToolRouting).toHaveBeenCalledWith(
				expect.objectContaining({ outcome: 'no_tool' })
			);
		});

		// Intenção que pede ticker, sem ticker: o orquestrador cai em unknown.
		it('when the chosen tool had nothing to answer with', async () => {
			orchestrator.orchestrate.mockResolvedValue(response('unknown'));
			planner.plan.mockResolvedValue(plan([{ intent: 'ri_question' }]));

			const answer = await makeRouter().answer(
				'u1',
				'O que disseram no release?'
			);

			expect(answer.routing.mode).toBe('regex');
			expect(costObserver.recordToolRouting).toHaveBeenCalledWith(
				expect.objectContaining({ outcome: 'unusable' })
			);
		});

		it('when one of the tools throws, keeping the others', async () => {
			orchestrator.orchestrate
				.mockResolvedValueOnce(response('unknown'))
				.mockRejectedValueOnce(new Error('mercado fora'))
				.mockResolvedValueOnce(response('dividends_received'));
			planner.plan.mockResolvedValue(
				plan([{ intent: 'portfolio_risk' }, { intent: 'dividends_received' }])
			);

			const answer = await makeRouter().answer(
				'u1',
				'Como estão meus investimentos?'
			);

			expect(answer.parts.map((p) => p.intent)).toEqual(['dividends_received']);
		});
	});

	// O roteador soma: a parte do regex não some se o LLM escolher só a outra.
	it('keeps the regex part of a question with two requests', async () => {
		orchestrator.orchestrate
			.mockResolvedValueOnce(response('asset_comparison'))
			.mockResolvedValueOnce(response('portfolio_risk'));
		planner.plan.mockResolvedValue(plan([{ intent: 'portfolio_risk' }]));

		const answer = await makeRouter().answer(
			'u1',
			'Compare PETR4 e VALE3 e diga o impacto no meu risco'
		);

		expect(answer.parts.map((p) => p.intent)).toEqual([
			'asset_comparison',
			'portfolio_risk',
		]);
	});

	it('survives an observer that rejects', async () => {
		costObserver.recordToolRouting.mockRejectedValue(new Error('metrics down'));
		orchestrator.orchestrate
			.mockResolvedValueOnce(response('unknown'))
			.mockResolvedValueOnce(response('portfolio_risk'));

		await expect(
			makeRouter().answer('u1', 'Estou exposto demais?')
		).resolves.toBeDefined();
	});

	it('never runs the same intent twice', async () => {
		orchestrator.orchestrate
			.mockResolvedValueOnce(response('unknown'))
			.mockResolvedValueOnce(response('portfolio_risk'));
		planner.plan.mockResolvedValue(
			plan([{ intent: 'portfolio_risk' }, { intent: 'portfolio_risk' }])
		);

		const answer = await makeRouter().answer('u1', 'Estou exposto demais?');

		expect(answer.parts).toHaveLength(1);
		expect(orchestrator.orchestrate).toHaveBeenCalledTimes(2);
	});
});
