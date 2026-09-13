import {
	rotateBatch,
	SectorBackfillScheduler,
} from './sector-backfill.scheduler';

function build(options: {
	symbols: string[];
	sectors?: Record<string, string | null | Error>;
}) {
	const assetModel = {
		distinct: jest.fn().mockResolvedValue(options.symbols),
		updateMany: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
	};
	const marketData = {
		getAssetSnapshot: jest.fn().mockImplementation(async (symbol: string) => {
			const value = options.sectors?.[symbol];
			if (value instanceof Error) throw value;
			return { symbol, sector: value ?? null };
		}),
		getManyAssetSnapshots: jest.fn(),
		getDailyCloses: jest.fn(),
	};
	const scheduler = new SectorBackfillScheduler(
		assetModel as any,
		marketData as any
	);
	return { scheduler, assetModel, marketData };
}

describe('SectorBackfillScheduler.backfill (TRA-144)', () => {
	it('preenche o setor por símbolo, com updateMany só nos pendentes', async () => {
		const { scheduler, assetModel } = build({
			symbols: ['PETR4'],
			sectors: { PETR4: 'Petróleo, Gás e Biocombustíveis' },
		});

		const result = await scheduler.backfill();

		expect(assetModel.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({ symbol: 'PETR4', sector: null }),
			{ $set: { sector: 'Petróleo, Gás e Biocombustíveis' } }
		);
		expect(result).toMatchObject({ pending: 1, attempted: 1, filled: 1 });
	});

	// Dez usuários com PETR4 compartilham uma consulta.
	it('consulta a fonte uma vez por símbolo distinto', async () => {
		const { scheduler, marketData } = build({
			symbols: ['PETR4', 'VALE3'],
			sectors: { PETR4: 'Petróleo', VALE3: 'Mineração' },
		});

		await scheduler.backfill();

		expect(marketData.getAssetSnapshot).toHaveBeenCalledTimes(2);
	});

	// Idempotente: nunca sobrescreve, nunca grava placeholder.
	it('não grava quando a fonte não tem setor ou devolve placeholder', async () => {
		const { scheduler, assetModel } = build({
			symbols: ['XPTO3', 'ABCD3'],
			sectors: { XPTO3: null, ABCD3: '-' },
		});

		const result = await scheduler.backfill();

		expect(assetModel.updateMany).not.toHaveBeenCalled();
		expect(result.filled).toBe(0);
	});

	it('segue para o próximo símbolo quando a fonte falha', async () => {
		const { scheduler, assetModel } = build({
			symbols: ['FALHA3', 'PETR4'],
			sectors: { FALHA3: new Error('429'), PETR4: 'Petróleo' },
		});

		const result = await scheduler.backfill();

		expect(assetModel.updateMany).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ attempted: 2, filled: 1 });
	});

	it('respeita o limite do lote', async () => {
		const symbols = Array.from({ length: 10 }, (_, i) => `SYM${i}3`);
		const sectors = Object.fromEntries(symbols.map((s) => [s, 'Setor']));
		const { scheduler, marketData } = build({ symbols, sectors });

		const result = await scheduler.backfill(
			3,
			new Date('2026-01-01T00:00:00Z')
		);

		expect(marketData.getAssetSnapshot).toHaveBeenCalledTimes(3);
		expect(result).toMatchObject({ pending: 10, attempted: 3 });
	});

	it('não faz nada quando não há pendência', async () => {
		const { scheduler, marketData } = build({ symbols: [] });

		const result = await scheduler.backfill();

		expect(marketData.getAssetSnapshot).not.toHaveBeenCalled();
		expect(result).toEqual({
			pending: 0,
			attempted: 0,
			filled: 0,
			updatedAssets: 0,
		});
	});
});

describe('rotateBatch', () => {
	const symbols = ['A', 'B', 'C', 'D', 'E'];

	it('devolve tudo quando cabe no lote', () => {
		expect(rotateBatch(['A', 'B'], 5, new Date())).toEqual(['A', 'B']);
	});

	// Sem rotação, símbolos que nunca têm setor ocupariam as primeiras vagas
	// todos os dias e travariam os demais.
	it('avança o lote a cada dia e dá a volta na lista', () => {
		const day0 = new Date(0);
		const day1 = new Date(24 * 60 * 60 * 1000);

		expect(rotateBatch(symbols, 2, day0)).toEqual(['A', 'B']);
		expect(rotateBatch(symbols, 2, day1)).toEqual(['C', 'D']);
	});

	it('é determinística para o mesmo dia', () => {
		const now = new Date('2026-03-15T10:00:00Z');
		expect(rotateBatch(symbols, 2, now)).toEqual(rotateBatch(symbols, 2, now));
	});

	it('cobre todos os símbolos ao longo dos dias', () => {
		const seen = new Set<string>();
		for (let day = 0; day < 5; day += 1) {
			for (const s of rotateBatch(symbols, 2, new Date(day * 86400000))) {
				seen.add(s);
			}
		}
		expect(seen.size).toBe(symbols.length);
	});
});
