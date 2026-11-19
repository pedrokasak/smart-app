import { BadRequestException } from '@nestjs/common';
import { businessDaysBetween } from '../../domain/position-valuation';
import type { FixedIncomePosition } from '../../domain/fixed-income.types';
import { FixedIncomePositionsService } from './fixed-income-positions.service';

// 16/06/2025 13h em Brasília.
const clock = () => new Date('2025-06-16T16:00:00.000Z');

const cdiDaily = businessDaysBetween('2025-06-02', '2025-06-16').map(
	(date) => ({ date, value: 0.05 })
);

const cdb: FixedIncomePosition = {
	kind: 'CDB',
	indexer: 'PERCENT_CDI',
	ratePct: 100,
	principal: 1000,
	appliedAt: '2025-06-02',
	maturityDate: '2027-06-01',
};

function build(series: object = { cdiDaily }) {
	const portfolio = {
		assertOwnership: jest.fn().mockResolvedValue(undefined),
		insertAsset: jest
			.fn()
			.mockImplementation((_id, asset) => Promise.resolve(asset)),
	};
	const reader = { load: jest.fn().mockResolvedValue(series) };
	const holdings = {
		listAll: jest.fn().mockResolvedValue([]),
		applyValuations: jest
			.fn()
			.mockImplementation((items) => Promise.resolve(items.length)),
	};
	const service = new FixedIncomePositionsService(
		portfolio,
		reader,
		holdings,
		clock
	);
	return { service, portfolio, reader, holdings };
}

describe('FixedIncomePositionsService (TRA-230)', () => {
	describe('create', () => {
		it('confere o dono, marca até hoje e grava como posição de 1 unidade', async () => {
			const { service, portfolio, reader } = build();

			const asset: any = await service.create('u1', 'p1', cdb);

			expect(portfolio.assertOwnership).toHaveBeenCalledWith('u1', 'p1');
			expect(reader.load).toHaveBeenCalledWith('2025-06-02', '2025-06-16');
			expect(asset).toMatchObject({
				name: 'CDB 100% do CDI · vence 06/2027',
				type: 'fixed_income',
				quantity: 1,
				price: 1000,
				avgPrice: 1000,
				total: 1005.01,
				currentPrice: 1005.01,
				currentPriceSource: 'curve',
				currentPriceAt: clock(),
				fixedIncome: {
					...cdb,
					valuation: expect.objectContaining({ netValue: 1001.82 }),
				},
			});
			expect(asset.symbol).toMatch(/^RF-CDB-CDI-202706-[0-9A-F]{6}$/);
		});

		it('sem série ainda: grava pelo valor aplicado, sem data de marcação', async () => {
			const { service } = build({});
			const asset: any = await service.create('u1', 'p1', cdb);

			expect(asset.total).toBe(1000);
			expect(asset.currentPriceAt).toBeUndefined();
			expect(asset.fixedIncome.valuation).toBeNull();
		});

		it.each([
			[{ appliedAt: '2025-06-17' }, 'futura'],
			[{ maturityDate: '2025-06-02' }, 'vencimento'],
			[{ ratePct: 0.5 }, 'faixa'],
			[{ kind: 'TESOURO' as const }, 'Tesouro não rende % do CDI'],
			[{ indexer: 'CDI_PLUS' as const, ratePct: 0.1 }, 'só do Tesouro Selic'],
		])('recusa dado incoerente %#', async (patch, message) => {
			const { service, portfolio } = build();
			await expect(
				service.create('u1', 'p1', { ...cdb, ...patch })
			).rejects.toThrow(message);
			await expect(
				service.create('u1', 'p1', { ...cdb, ...patch })
			).rejects.toBeInstanceOf(BadRequestException);
			expect(portfolio.insertAsset).not.toHaveBeenCalled();
		});
	});

	describe('markAll', () => {
		it('lê as séries desde a aplicação mais antiga e grava só o que marcou', async () => {
			const { service, reader, holdings } = build();
			holdings.listAll.mockResolvedValue([
				{ id: 'a1', position: cdb },
				{
					id: 'a2',
					position: {
						...cdb,
						kind: 'TESOURO',
						indexer: 'IPCA_PLUS',
						ratePct: 6,
						appliedAt: '2025-06-01',
					},
				},
			]);

			const written = await service.markAll();

			expect(reader.load).toHaveBeenCalledWith('2025-06-01', '2025-06-16');
			// O IPCA+ não tem série de IPCA aqui: fica de fora.
			expect(written).toBe(1);
			const [items, markedAt] = holdings.applyValuations.mock.calls[0];
			expect(items).toEqual([
				{
					id: 'a1',
					valuation: expect.objectContaining({ grossValue: 1005.01 }),
				},
			]);
			expect(markedAt).toEqual(clock());
		});

		it('sem posição não lê série', async () => {
			const { service, reader } = build();
			await expect(service.markAll()).resolves.toBe(0);
			expect(reader.load).not.toHaveBeenCalled();
		});

		it('falha de leitura não derruba o job', async () => {
			const { service, holdings } = build();
			holdings.listAll.mockRejectedValue(new Error('mongo fora'));
			await expect(service.markAll()).resolves.toBe(0);
		});
	});
});
