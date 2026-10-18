import { RagIngestionScheduler } from 'src/ai/rag-ingestion/application/rag-ingestion.scheduler';
import {
	FREE_ACCESS_LEVEL,
	PREMIUM_ACCESS_LEVEL,
	PRO_ACCESS_LEVEL,
} from 'src/subscription/application/user-plan.types';

describe('RagIngestionScheduler (TRA-84)', () => {
	let userModel: { find: jest.Mock };
	let portfolioService: { getUserPortfolios: jest.Mock };
	let factBuilder: { build: jest.Mock; buildDerived: jest.Mock };
	let tradeSource: { listTrades: jest.Mock };
	let ingestion: { ingest: jest.Mock };
	let planResolver: { resolve: jest.Mock; resolveWithCapabilities: jest.Mock };
	let scheduler: RagIngestionScheduler;

	function mockTier(tier: number) {
		planResolver.resolveWithCapabilities.mockResolvedValue({
			tier,
			capabilities: [],
		});
	}

	beforeEach(() => {
		userModel = { find: jest.fn() };
		portfolioService = {
			getUserPortfolios: jest
				.fn()
				.mockResolvedValue([{ assets: [{ symbol: 'PETR4', quantity: 100 }] }]),
		};
		tradeSource = { listTrades: jest.fn().mockResolvedValue([]) };
		factBuilder = {
			buildDerived: jest.fn().mockReturnValue([]),
			build: jest.fn().mockReturnValue([
				{
					sourceType: 'portfolio_position',
					sourceId: 'position:PETR4',
					content: 'x',
				},
			]),
		};
		ingestion = {
			ingest: jest.fn().mockResolvedValue({ ingested: true, chunksCreated: 1 }),
		};
		planResolver = {
			resolve: jest.fn().mockResolvedValue(PRO_ACCESS_LEVEL),
			resolveWithCapabilities: jest
				.fn()
				.mockResolvedValue({ tier: PRO_ACCESS_LEVEL, capabilities: [] }),
		};
		scheduler = new RagIngestionScheduler(
			userModel as never,
			portfolioService as never,
			factBuilder as never,
			ingestion as never,
			planResolver as never,
			tradeSource as never
		);
	});

	it('ingests for a Pro user with a portfolio', async () => {
		const ok = await scheduler.ingestForUser('user-1');
		expect(ok).toBe(true);
		expect(ingestion.ingest).toHaveBeenCalledTimes(1);
	});

	it('adds the derived trade and fixed income facts to the ingest (ADR-002)', async () => {
		const trades = [{ assetSymbol: 'ITSA4' }];
		tradeSource.listTrades.mockResolvedValue(trades);
		factBuilder.buildDerived.mockReturnValue([
			{
				sourceType: 'portfolio_trade_summary',
				sourceId: 'trade_summary:ITSA4:2026-03',
				content: 'y',
			},
		]);

		await scheduler.ingestForUser('user-1');

		expect(tradeSource.listTrades).toHaveBeenCalledWith('user-1');
		expect(factBuilder.buildDerived).toHaveBeenCalledWith(
			{ trades, assets: [{ symbol: 'PETR4', quantity: 100 }] },
			expect.any(String)
		);
		const sent = ingestion.ingest.mock.calls[0][1];
		expect(sent.map((i: { sourceType: string }) => i.sourceType)).toEqual([
			'portfolio_position',
			'portfolio_trade_summary',
		]);
	});

	it('never reads trades for a free user (cost and privacy gate)', async () => {
		mockTier(FREE_ACCESS_LEVEL);

		await scheduler.ingestForUser('user-free');

		expect(tradeSource.listTrades).not.toHaveBeenCalled();
	});

	it('SKIPS a free user entirely — no fact build, no ingest (cost gate)', async () => {
		mockTier(FREE_ACCESS_LEVEL);

		const ok = await scheduler.ingestForUser('user-free');

		expect(ok).toBe(false);
		expect(portfolioService.getUserPortfolios).not.toHaveBeenCalled();
		expect(factBuilder.build).not.toHaveBeenCalled();
		expect(ingestion.ingest).not.toHaveBeenCalled();
	});

	it('allows premium and global_investor too', async () => {
		for (const tier of [PREMIUM_ACCESS_LEVEL, PREMIUM_ACCESS_LEVEL + 10]) {
			ingestion.ingest.mockClear();
			mockTier(tier);
			await scheduler.ingestForUser('user-x');
			expect(ingestion.ingest).toHaveBeenCalledTimes(1);
		}
	});

	it('does not ingest when the Pro user has an empty portfolio', async () => {
		portfolioService.getUserPortfolios.mockResolvedValue([{ assets: [] }]);
		const ok = await scheduler.ingestForUser('user-empty');
		expect(ok).toBe(false);
		expect(ingestion.ingest).not.toHaveBeenCalled();
	});

	it('returns false when ingestion fails but does not throw (isolated failure)', async () => {
		ingestion.ingest.mockResolvedValue({
			ingested: false,
			failureReason: 'down',
		});
		await expect(scheduler.ingestForUser('user-1')).resolves.toBe(false);
	});

	it('isolates per-user failures in the daily scan with allSettled', async () => {
		userModel.find.mockResolvedValue([
			{ _id: 'a' },
			{ _id: 'b' },
			{ _id: 'c' },
		]);
		const spy = jest
			.spyOn(scheduler, 'ingestForUser')
			.mockResolvedValueOnce(true)
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValueOnce(true);

		await expect(scheduler.ingestDaily()).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalledTimes(3);
	});
});
