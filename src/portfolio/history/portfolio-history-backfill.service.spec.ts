import {
	PortfolioHistoryBackfillService,
	replaceableCostPoint,
} from './portfolio-history-backfill.service';

describe('PortfolioHistoryBackfillService', () => {
	const makeService = (params: {
		trades: any[];
		closes?: Record<string, { date: string; close: number }[]>;
		upsertedCount?: number;
		modifiedCount?: number;
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

	// TRA-279: o ponto gravado a custo numa reconstrução sem fechamento fazia
	// a diferença custo → mercado virar rendimento de um dia só.
	it('troca ponto a custo pelo valor com fechamento, sem criar ponto novo', async () => {
		const { service, historyModel } = makeService({
			trades: [trade()],
			closes: { PETR4: closes(daysAgo(30), 31) },
			modifiedCount: 12,
		});

		const result = await service.backfill({ userId: 'u1', portfolioId: 'p1' });

		const [operations] = (historyModel.bulkWrite as jest.Mock).mock.calls[0];
		const replace = operations[1].updateOne;
		expect(replace.upsert).toBeUndefined();
		expect(replace.filter).toMatchObject({
			portfolioId: 'p1',
			...replaceableCostPoint(0),
		});
		expect(replace.update.$set).toMatchObject({ stale: false });
		expect(replace.update.$set.totalValue).toBeGreaterThan(0);
		expect(replace.update.$setOnInsert).toBeUndefined();
		expect(result.replaced).toBe(12);
	});

	it('com símbolo ainda sem cotação, só troca ponto pior que o novo', async () => {
		const { service, historyModel } = makeService({
			trades: [trade(), trade({ symbol: 'XPTO3' })],
			closes: { PETR4: closes(daysAgo(30), 31) },
		});

		await service.backfill({ userId: 'u1', portfolioId: 'p1' });

		const [operations] = (historyModel.bulkWrite as jest.Mock).mock.calls[0];
		expect(operations[1].updateOne.filter).toMatchObject(
			replaceableCostPoint(1)
		);
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

describe('replaceableCostPoint (TRA-279)', () => {
	// O filtro roda no Mongo; aqui fica o contrato de quem ele pode trocar.
	it('casa ponto anterior à TRA-143 (sem investedValue)', () => {
		expect(replaceableCostPoint(0).$or).toContainEqual({
			investedValue: { $exists: false },
		});
	});

	it('casa ponto stale só se tiver mais símbolos sem cotação que o novo', () => {
		const staleBranch = replaceableCostPoint(2).$or[1] as any;
		expect(staleBranch.stale).toBe(true);
		expect(staleBranch.$expr.$gt[1]).toBe(2);
	});

	it('nunca casa snapshot com cotação: exige stale ou investedValue ausente', () => {
		for (const branch of replaceableCostPoint(0).$or as any[]) {
			const requiresStale = branch.stale === true;
			const requiresLegacy = branch.investedValue?.$exists === false;
			expect(requiresStale || requiresLegacy).toBe(true);
		}
	});
});
