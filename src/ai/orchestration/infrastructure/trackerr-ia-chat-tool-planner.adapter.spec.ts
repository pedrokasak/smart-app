import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { TrackerrIaChatToolPlannerAdapter } from 'src/ai/orchestration/infrastructure/trackerr-ia-chat-tool-planner.adapter';
import {
	CHAT_TOOL_CATALOG,
	chatToolByName,
} from 'src/ai/orchestration/tool-routing/chat-tool-catalog';

describe('TrackerrIaChatToolPlannerAdapter (TRA-241)', () => {
	let httpService: { post: jest.Mock };
	let adapter: TrackerrIaChatToolPlannerAdapter;

	beforeEach(() => {
		httpService = { post: jest.fn() };
		adapter = new TrackerrIaChatToolPlannerAdapter(
			httpService as unknown as HttpService
		);
	});

	const plan = () =>
		adapter.plan({
			question: 'Compare PETR4 e VALE3 e diga o impacto no meu risco',
			tools: CHAT_TOOL_CATALOG,
			maxCalls: 3,
		});

	it('sends the catalog with the arguments schema and a short timeout', async () => {
		httpService.post.mockReturnValue(of({ data: { calls: [] } }));

		await plan();

		const [url, body, config] = httpService.post.mock.calls[0];
		expect(url).toMatch(/\/api\/chat\/plan$/);
		expect(body.max_calls).toBe(3);
		expect(body.tools).toHaveLength(CHAT_TOOL_CATALOG.length);
		const comparison = body.tools.find(
			(tool: { name: string }) => tool.name === 'asset_comparison'
		);
		expect(comparison.parameters.properties.tickers.maxItems).toBe(4);
		const risk = body.tools.find(
			(tool: { name: string }) => tool.name === 'portfolio_risk'
		);
		expect(risk.parameters).toEqual({ type: 'object', properties: {} });
		expect(config.timeout).toBe(TrackerrIaChatToolPlannerAdapter.TIMEOUT_MS);
	});

	it('reads the calls without trusting them', async () => {
		httpService.post.mockReturnValue(
			of({
				data: {
					calls: [
						{
							name: 'asset_comparison',
							arguments: { tickers: ['petr4', 'VALE3', 'PETR4', 'DROP TABLE'] },
						},
						{ name: 'delete_user', arguments: {} },
						{ name: 'portfolio_risk', arguments: { tickers: ['PETR4'] } },
					],
					provider: 'openrouter',
					input_tokens: 400,
					output_tokens: 35,
					reason: null,
				},
			})
		);

		await expect(plan()).resolves.toEqual({
			calls: [
				{ intent: 'asset_comparison', tickers: ['PETR4', 'VALE3'] },
				// Ferramenta sem ticker não leva ticker.
				{ intent: 'portfolio_risk', tickers: [] },
			],
			provider: 'openrouter',
			inputTokens: 400,
			outputTokens: 35,
			reason: null,
		});
	});

	it('fails on a response that is not a plan', async () => {
		httpService.post.mockReturnValue(of({ data: { detail: 'erro' } }));

		await expect(plan()).rejects.toThrow('chat_plan_unexpected_response');
	});
});

describe('CHAT_TOOL_CATALOG (TRA-241)', () => {
	it('never offers the investment committee, refusals or the narrative', () => {
		for (const name of [
			'investment_committee',
			'narrative_synthesis',
			'unknown',
			'market_screening',
			'unsupported_quant_analysis',
		]) {
			expect(chatToolByName(name)).toBeNull();
		}
	});

	it('has unique names and a description for each tool', () => {
		const names = CHAT_TOOL_CATALOG.map((tool) => tool.name);
		expect(new Set(names).size).toBe(names.length);
		for (const tool of CHAT_TOOL_CATALOG) {
			expect(tool.description.length).toBeGreaterThan(10);
			expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
		}
	});
});
