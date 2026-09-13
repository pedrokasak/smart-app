import { PortfolioHistoryBackfillService } from './portfolio-history-backfill.service';

describe('PortfolioHistoryBackfillService', () => {
	const makeService = (params: {
		trades: any[];
		closes?: Record<string, { date: string; close: number }[]>;
		upsertedCount?: number;
	}) => {
		const tradeModel = {
			find: jest.fn().mockReturnValue({
				sort: jest.fn().mockReturnValue({
					lean: jest.fn().mockReturnValue({
						exec: jest.fn().mockResolvedValue(params.trades),
					}),
				}),
			}),
		};
		const historyModel = {
			bulkWrite: jest.fn().mockResolvedValue({
				upsertedCount: params.upsertedCount ?? 10,
			}),
		};
		const marketData = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn(),
			getDailyCloses: jest
				.fn()
				.mockImplementation(async (symbol: string) =>
					params.closes?.[symbol] ? params.closes[symbol] : []
				),
		};

		const service = new PortfolioHistoryBackfillService(
			tradeModel as any,
			historyModel as any,
			marketData as any
		);
		return { service, tradeModel, historyModel, marketData };
	};

	/** Datas relativas a hoje: a janela pedida ao provedor depende da idade
	 * da primeira negociação, então data fixa quebraria com o tempo. */
	const daysAgo = (days: number): Date => {
		const date = new Date();
		date.setUTCHours(0, 0, 0, 0);
		date.setUTCDate(date.getUTCDate() - days);
		return date;
	};
	const iso = (date: Date): string => date.toISOString().slice(0, 10);

	const trade = (overrides: Record<string, any> = {}) => ({
		symbol: 'PETR4',
		side: 'buy',
		quantity: 100,
		price: 30,
		date: daysAgo(30),
		...overrides,
	});

	const closes = (from: Date, days: number) => {
		const out: { date: string; close: number }[] = [];
		const cursor = new Date(from);
		for (let i = 0; i < days; i += 1) {
			out.push({
				date: cursor.toISOString().slice(0, 10),
				close: 30 + i * 0.1,
			});
			cursor.setUTCDate(cursor.getUTCDate() + 1);
		}
		return out;
	};

	// Sem negociação importada não há como saber a posição passada.
	it('não reconstrói carteira sem negociação', async () => {
		const { service, historyModel } = makeService({ trades: [] });

		const result = await service.backfill({
			userId: 'u1',
			portfolioId: 'p1',
		});

		expect(result).toEqual({
			covered: false,
			written: 0,
			from: null,
			to: null,
			missingSymbols: [],
		});
		expect(historyModel.bulkWrite).not.toHaveBeenCalled();
	});

	it('reconstrói a série e devolve a janela gravada', async () => {
		const { service, historyModel, marketData } = makeService({
			trades: [trade()],
			closes: { PETR4: closes(daysAgo(30), 31) },
			upsertedCount: 25,
		});

		const result = await service.backfill({ userId: 'u1', portfolioId: 'p1' });

		expect(marketData.getDailyCloses).toHaveBeenCalledWith('PETR4', '1y');
		expect(result.covered).toBe(true);
		expect(result.written).toBe(25);
		expect(result.from).toBe(iso(daysAgo(30)));
		expect(historyModel.bulkWrite).toHaveBeenCalled();
	});

	// Snapshot do dia foi calculado com a cotação daquele momento: é melhor
	// fonte que a reconstrução, e não pode ser sobrescrito.
	it('grava apenas o que falta, com $setOnInsert', async () => {
		const { service, historyModel } = makeService({
			trades: [trade()],
			closes: { PETR4: closes(daysAgo(30), 31) },
		});

		await service.backfill({ userId: 'u1', portfolioId: 'p1' });

		const [operations] = (historyModel.bulkWrite as jest.Mock).mock.calls[0];
		expect(operations[0].updateOne.upsert).toBe(true);
		expect(operations[0].updateOne.update.$setOnInsert).toMatchObject({
			portfolioId: 'p1',
			userId: 'u1',
		});
		expect(operations[0].updateOne.update.$set).toBeUndefined();
	});

	it('declara o símbolo sem cotação em vez de escondê-lo', async () => {
		const { service } = makeService({
			trades: [trade(), trade({ symbol: 'XPTO3' })],
			closes: { PETR4: closes(daysAgo(30), 31) },
		});

		const result = await service.backfill({ userId: 'u1', portfolioId: 'p1' });

		expect(result.missingSymbols).toEqual(['XPTO3']);
		expect(result.covered).toBe(true);
	});

	// Janela pedida ao provedor acompanha a idade da primeira negociação.
	it('pede janela maior para carteira antiga', async () => {
		const { service, marketData } = makeService({
			trades: [trade({ date: daysAgo(3 * 365) })],
			closes: { PETR4: closes(daysAgo(3 * 365), 31) },
		});

		await service.backfill({ userId: 'u1', portfolioId: 'p1' });

		expect(marketData.getDailyCloses).toHaveBeenCalledWith('PETR4', '5y');
	});

	it('falha de cotação não derruba a reconstrução', async () => {
		const { service, marketData } = makeService({
			trades: [trade()],
			closes: { PETR4: closes(daysAgo(30), 31) },
		});
		(marketData.getDailyCloses as jest.Mock).mockRejectedValueOnce(
			new Error('rate limit')
		);

		const result = await service.backfill({ userId: 'u1', portfolioId: 'p1' });

		expect(result.covered).toBe(true);
		expect(result.missingSymbols).toEqual(['PETR4']);
	});
});
