import {
	firstSnapshotDate,
	ownCostOnlyPoint,
	PortfolioHistoryBackfillService,
} from './portfolio-history-backfill.service';

describe('PortfolioHistoryBackfillService', () => {
	const makeService = (params: {
		trades: any[];
		closes?: Record<string, { date: string; close: number }[]>;
		upsertedCount?: number;
		modifiedCount?: number;
		existingRows?: { date: string; createdAt: Date }[];
		assetTypes?: Record<string, string>;
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
			find: jest.fn().mockReturnValue({
				select: jest.fn().mockReturnValue({
					lean: jest.fn().mockReturnValue({
						exec: jest.fn().mockResolvedValue(params.existingRows ?? []),
					}),
				}),
			}),
			bulkWrite: jest.fn().mockResolvedValue({
				upsertedCount: params.upsertedCount ?? 10,
				modifiedCount: params.modifiedCount ?? 0,
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

		const portfolioService = {
			getPortfolioWithAssets: jest.fn().mockResolvedValue({
				assets: Object.entries(params.assetTypes ?? {}).map(
					([symbol, type]) => ({ symbol, type })
				),
			}),
		};

		const service = new PortfolioHistoryBackfillService(
			tradeModel as any,
			historyModel as any,
			marketData as any,
			portfolioService as any
		);
		return { service, tradeModel, historyModel, marketData, portfolioService };
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
			replaced: 0,
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

		expect(marketData.getDailyCloses).toHaveBeenCalledWith(
			'PETR4',
			'1y',
			'stock'
		);
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

	// TRA-279: a rodada anterior não achou fechamento e gravou tudo a custo.
	it('troca só a linha a custo que ela mesma gravou, sem upsert', async () => {
		const { service, historyModel } = makeService({
			trades: [trade()],
			closes: { PETR4: closes(daysAgo(30), 31) },
			modifiedCount: 20,
		});

		const result = await service.backfill({ userId: 'u1', portfolioId: 'p1' });

		const [operations] = (historyModel.bulkWrite as jest.Mock).mock.calls[0];
		const replace = operations[1].updateOne;
		expect(replace.upsert).toBeUndefined();
		expect(replace.update.$setOnInsert).toBeUndefined();
		expect(replace.filter).toMatchObject({
			portfolioId: 'p1',
			date: iso(daysAgo(30)),
			...ownCostOnlyPoint(iso(daysAgo(30)), 0),
		});
		expect(replace.update.$set.stale).toBe(false);
		expect(result.replaced).toBe(20);
	});

	// TRA-279: num dia sem snapshot (08/10) a reconstrução gravava o valor só
	// dos ativos com nota, sem as posições do relatório consolidado.
	it('não escreve a partir do primeiro snapshot diário', async () => {
		const snapshotDay = iso(daysAgo(10));
		const { service, historyModel } = makeService({
			trades: [trade()],
			closes: { PETR4: closes(daysAgo(30), 31) },
			existingRows: [
				{ date: snapshotDay, createdAt: new Date(`${snapshotDay}T22:30:00Z`) },
			],
		});

		const result = await service.backfill({ userId: 'u1', portfolioId: 'p1' });

		const [operations] = (historyModel.bulkWrite as jest.Mock).mock.calls[0];
		const dates = operations.map((op: any) => op.updateOne.filter.date);
		expect(dates.every((date: string) => date < snapshotDay)).toBe(true);
		expect(result.to).toBe(iso(daysAgo(11)));
	});

	it('sem snapshot, reconstrói até ontem: o de hoje sai às 19:30', async () => {
		const { service } = makeService({
			trades: [trade()],
			closes: { PETR4: closes(daysAgo(30), 31) },
		});

		const result = await service.backfill({ userId: 'u1', portfolioId: 'p1' });

		expect(result.to).toBe(iso(daysAgo(1)));
	});

	it('linha nova grava as próprias datas e não toca updatedAt das existentes', async () => {
		const { service, historyModel } = makeService({
			trades: [trade()],
			closes: { PETR4: closes(daysAgo(30), 31) },
		});

		await service.backfill({ userId: 'u1', portfolioId: 'p1' });

		const [operations] = (historyModel.bulkWrite as jest.Mock).mock.calls[0];
		expect(operations[0].updateOne.timestamps).toBe(false);
		expect(
			operations[0].updateOne.update.$setOnInsert.createdAt
		).toBeInstanceOf(Date);
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

		expect(marketData.getDailyCloses).toHaveBeenCalledWith(
			'PETR4',
			'5y',
			'stock'
		);
	});

	// Cripto buscada como ação viria com série errada: o tipo do ativo do
	// portfólio tem que acompanhar o símbolo até o provedor.
	it('repassa o tipo do ativo ao provedor', async () => {
		const { service, marketData } = makeService({
			trades: [trade(), trade({ symbol: 'BTC' })],
			closes: {
				PETR4: closes(daysAgo(30), 31),
				BTC: closes(daysAgo(30), 31),
			},
			assetTypes: { PETR4: 'stock', BTC: 'crypto' },
		});

		await service.backfill({ userId: 'u1', portfolioId: 'p1' });

		expect(marketData.getDailyCloses).toHaveBeenCalledWith(
			'BTC',
			'1y',
			'crypto'
		);
		expect(marketData.getDailyCloses).toHaveBeenCalledWith(
			'PETR4',
			'1y',
			'stock'
		);
	});

	it('cai em ação quando não consegue ler os tipos', async () => {
		const { service, marketData, portfolioService } = makeService({
			trades: [trade()],
			closes: { PETR4: closes(daysAgo(30), 31) },
		});
		portfolioService.getPortfolioWithAssets.mockRejectedValueOnce(
			new Error('db')
		);

		const result = await service.backfill({ userId: 'u1', portfolioId: 'p1' });

		expect(result.covered).toBe(true);
		expect(marketData.getDailyCloses).toHaveBeenCalledWith(
			'PETR4',
			'1y',
			'stock'
		);
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

describe('ownCostOnlyPoint (TRA-279)', () => {
	// O snapshot diário grava o próprio dia; só a reconstrução escreve no
	// passado. É isso que impede de trocar um snapshot da carteira inteira por
	// um valor que só conhece os ativos com negociação.
	it('exige que a linha tenha sido gravada depois do dia que representa', () => {
		const filter = ownCostOnlyPoint('2025-07-21', 0);
		expect(filter.createdAt.$gt.toISOString()).toBe('2025-07-23T00:00:00.000Z');
	});

	it('exige stale, custo registrado e valor igual ao custo', () => {
		const filter = ownCostOnlyPoint('2025-07-21', 0) as any;
		expect(filter.stale).toBe(true);
		expect(filter.investedValue).toEqual({ $exists: true, $ne: null });
		expect(filter.$expr.$and[0].$lte[1]).toBe(0.01);
	});

	it('só troca se o ponto novo tiver menos símbolos sem cotação', () => {
		const filter = ownCostOnlyPoint('2025-07-21', 2) as any;
		expect(filter.$expr.$and[1].$gt[1]).toBe(2);
	});
});

describe('firstSnapshotDate (TRA-279)', () => {
	it('é o primeiro dia gravado no próprio dia, não pela reconstrução', () => {
		expect(
			firstSnapshotDate([
				// reconstrução: gravada meses depois
				{ date: '2025-01-07', createdAt: new Date('2026-09-15T03:59:00Z') },
				// snapshot das 19:30 (22:30 UTC)
				{ date: '2026-09-14', createdAt: new Date('2026-09-14T22:30:00Z') },
				{ date: '2026-09-15', createdAt: new Date('2026-09-15T22:30:00Z') },
			])
		).toBe('2026-09-14');
	});

	it('sem snapshot devolve null', () => {
		expect(
			firstSnapshotDate([
				{ date: '2025-01-07', createdAt: new Date('2026-09-15T03:59:00Z') },
			])
		).toBeNull();
		expect(firstSnapshotDate([])).toBeNull();
	});
});
