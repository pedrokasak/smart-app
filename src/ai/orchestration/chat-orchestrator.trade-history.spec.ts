import { ChatOrchestratorService } from 'src/ai/orchestration/chat-orchestrator.service';
import { CHAT_TOOL_CATALOG } from 'src/ai/orchestration/tool-routing/chat-tool-catalog';
import { buildAnswerSources } from 'src/ai/orchestration/answer-confidence';

describe('ChatOrchestratorService: trade_history (ADR-002, TRA-16, fase 2)', () => {
	const tradeRows = [
		{
			symbol: 'ITSA4',
			side: 'buy' as const,
			quantity: 100,
			price: 10,
			fees: 2,
			date: new Date('2026-03-10T00:00:00.000Z'),
		},
		{
			symbol: 'ITSA4',
			side: 'buy' as const,
			quantity: 200,
			price: 11,
			fees: 3,
			date: new Date('2026-05-02T00:00:00.000Z'),
		},
	];

	let cache: { get: jest.Mock; set: jest.Mock };
	let tradeHistory: { listTrades: jest.Mock };

	const build = (withTrades = true) =>
		new ChatOrchestratorService(
			{
				getUserPortfolios: jest.fn().mockResolvedValue([
					{
						assets: [
							{ symbol: 'ITSA4', type: 'stock', quantity: 300, total: 3200 },
						],
					},
				]),
			} as never,
			{} as never,
			{ getDailyCloses: jest.fn().mockResolvedValue([]) } as never,
			cache as never,
			{ record: jest.fn() } as never,
			{} as never,
			{
				getAllNational: jest
					.fn()
					.mockResolvedValue({ stocks: [{ stock: 'ITSA4', name: 'Itausa' }] }),
			} as never,
			{ resolve: jest.fn().mockResolvedValue('free') } as never,
			{} as never,
			{} as never,
			{} as never,
			undefined,
			withTrades ? (tradeHistory as never) : undefined
		);

	beforeEach(() => {
		cache = {
			get: jest.fn().mockResolvedValue(null),
			set: jest.fn().mockResolvedValue(undefined),
		};
		tradeHistory = { listTrades: jest.fn().mockResolvedValue(tradeRows) };
	});

	it('answers "quando comprei ITSA4" with the exact sums, from the token user', async () => {
		const response = await build().orchestrate(
			'user-1',
			'Quando comprei ITSA4 em 2026?'
		);

		expect(response.intent).toBe('trade_history');
		expect(response.route.type).toBe('deterministic_no_llm');
		expect(response.cost.llmCalls).toBe(0);
		expect(tradeHistory.listTrades).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				symbol: 'ITSA4',
				side: 'buy',
				from: '2026-01-01',
			})
		);
		expect((response.data as any).tradeHistory).toMatchObject({
			count: 2,
			buys: { count: 2, quantity: 300, total: 3200 },
			fees: 5,
		});
	});

	it('NEVER reads or writes the shared response cache (its key is the portfolio hash)', async () => {
		const response = await build().orchestrate(
			'user-1',
			'Quando comprei ITSA4?'
		);

		expect(response.cache.hit).toBe(false);
		expect(cache.get).not.toHaveBeenCalled();
		expect(cache.set).not.toHaveBeenCalled();
	});

	it('recognises the other phrasings and sends them to the same tool', async () => {
		for (const question of [
			'Quanto paguei de corretagem em 2025?',
			'Quais foram minhas compras este ano?',
			'o que vendi mês passado',
			'histórico de operações',
		]) {
			const response = await build().orchestrate('user-1', question);
			expect(response.intent).toBe('trade_history');
		}
	});

	it('does not steal a sell simulation question', () => {
		const classify = (build() as any).classifyIntent.bind(build());

		expect(
			classify('simule a venda de 100 ações de itsa4 a r$ 12', ['ITSA4'], {})
		).toBe('sell_simulation');
		expect(
			classify('e se eu vender minha petr4 hoje?', ['PETR4'], {})
		).not.toBe('trade_history');
	});

	it('says the data is unavailable instead of failing when the port is not wired', async () => {
		const response = await build(false).orchestrate(
			'user-1',
			'Quando comprei ITSA4?'
		);

		expect(response.intent).toBe('trade_history');
		expect(response.route.reason).toBe('insufficient_structured_data');
		expect(response.unavailable ?? []).toContain('trade_history_unavailable');
	});

	it('works when the router picks the tool, taking only the ticker from it', async () => {
		await build().orchestrate('user-1', 'e em 2025?', {
			plannedCall: { intent: 'trade_history', symbols: ['ITSA4'] },
		});

		expect(tradeHistory.listTrades).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				symbol: 'ITSA4',
				from: '2025-01-01',
				to: '2025-12-31',
			})
		);
	});

	it('is offered to the tool router as a single-ticker tool', () => {
		const tool = CHAT_TOOL_CATALOG.find((t) => t.name === 'trade_history');
		expect(tool).toBeDefined();
		expect(tool?.maxTickers).toBe(1);
	});

	it('cites the imported trades as the source, not the positions', () => {
		const sources = buildAnswerSources({
			intent: 'trade_history',
			positionsCount: 3,
			data: { tradeHistory: { count: 2 } },
		});

		expect(sources).toEqual(['Suas operações importadas']);
	});
});
