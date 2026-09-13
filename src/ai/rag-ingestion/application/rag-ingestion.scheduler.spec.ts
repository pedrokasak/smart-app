import { RagIngestionScheduler } from 'src/ai/rag-ingestion/application/rag-ingestion.scheduler';

describe('RagIngestionScheduler (TRA-84)', () => {
	let userModel: { find: jest.Mock };
	let portfolioService: { getUserPortfolios: jest.Mock };
	let factBuilder: { build: jest.Mock };
	let ingestion: { ingest: jest.Mock };
	let planResolver: { resolve: jest.Mock };
	let scheduler: RagIngestionScheduler;

	beforeEach(() => {
		userModel = { find: jest.fn() };
		portfolioService = {
			getUserPortfolios: jest
				.fn()
				.mockResolvedValue([{ assets: [{ symbol: 'PETR4', quantity: 100 }] }]),
		};
		factBuilder = {
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
		planResolver = { resolve: jest.fn().mockResolvedValue('pro') };
		scheduler = new RagIngestionScheduler(
			userModel as never,
			portfolioService as never,
			factBuilder as never,
			ingestion as never,
			planResolver as never
		);
	});

	it('ingests for a Pro user with a portfolio', async () => {
		const ok = await scheduler.ingestForUser('user-1');
		expect(ok).toBe(true);
		expect(ingestion.ingest).toHaveBeenCalledTimes(1);
	});

	it('SKIPS a free user entirely — no fact build, no ingest (cost gate)', async () => {
		planResolver.resolve.mockResolvedValue('free');

		const ok = await scheduler.ingestForUser('user-free');

		expect(ok).toBe(false);
		expect(portfolioService.getUserPortfolios).not.toHaveBeenCalled();
		expect(factBuilder.build).not.toHaveBeenCalled();
		expect(ingestion.ingest).not.toHaveBeenCalled();
	});

	it('allows premium and global_investor too', async () => {
		for (const tier of ['premium', 'global_investor']) {
			ingestion.ingest.mockClear();
			planResolver.resolve.mockResolvedValue(tier);
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
