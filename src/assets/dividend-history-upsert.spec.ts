import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AssetsService } from './assets.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';

/**
 * O importador antigo carimbava todo provento com a data do upload. A
 * impressão digital do merge é `data|tipo|valor`, então os mesmos
 * proventos com a data real têm chave diferente e sobreviveriam lado a
 * lado com os errados — reimportar dobraria o total recebido em vez de
 * consertá-lo.
 *
 * `replaceRange` existe para isso: o extrato de movimentação afirma o que
 * aconteceu num período, então substitui aquela janela inteira.
 */
describe('AssetsService.upsertDividendHistoryEntries', () => {
	let service: AssetsService;
	let savedHistory: any[];

	const mockAssetModel = {
		findById: jest.fn(),
		findByIdAndUpdate: jest.fn(),
	};

	beforeEach(async () => {
		savedHistory = [];
		jest.clearAllMocks();

		mockAssetModel.findByIdAndUpdate.mockImplementation(
			(_id: string, update: any) => {
				savedHistory = update?.$set?.dividendHistory ?? [];
				return Promise.resolve({ dividendHistory: savedHistory });
			}
		);

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AssetsService,
				{ provide: getModelToken('Asset'), useValue: mockAssetModel },
				{ provide: PortfolioService, useValue: {} },
			],
		}).compile();

		service = module.get<AssetsService>(AssetsService);
	});

	const withExistingHistory = (history: any[]) => {
		mockAssetModel.findById.mockResolvedValue({ dividendHistory: history });
	};

	const iso = (entry: any) => new Date(entry.date).toISOString().slice(0, 10);

	it('sem replaceRange, mantém o histórico antigo e soma o novo', async () => {
		withExistingHistory([
			{ date: new Date('2026-08-25'), value: 1.5, paymentType: 'JCP' },
		]);

		await service.upsertDividendHistoryEntries('asset1', [
			{ date: new Date('2025-09-20'), value: 1.5, paymentType: 'JCP' },
		]);

		// Datas diferentes => impressões diferentes => os dois sobrevivem.
		expect(savedHistory).toHaveLength(2);
	});

	it('com replaceRange, troca a janela inteira em vez de duplicar', async () => {
		// Cenário real: provento carimbado com a data do upload (25/08/2026)
		// enquanto o pagamento verdadeiro foi em 20/09/2025.
		withExistingHistory([
			{ date: new Date('2026-08-25'), value: 1.5, paymentType: 'JCP' },
		]);

		await service.upsertDividendHistoryEntries(
			'asset1',
			[{ date: new Date('2025-09-20'), value: 1.5, paymentType: 'JCP' }],
			{
				replaceRange: {
					from: new Date('2025-04-01'),
					to: new Date('2026-08-31'),
				},
			}
		);

		expect(savedHistory).toHaveLength(1);
		expect(iso(savedHistory[0])).toBe('2025-09-20');
	});

	it('preserva proventos fora da janela substituída', async () => {
		withExistingHistory([
			{ date: new Date('2024-03-10'), value: 9.9, paymentType: 'DIVIDEND' },
			{ date: new Date('2026-08-25'), value: 1.5, paymentType: 'JCP' },
		]);

		await service.upsertDividendHistoryEntries(
			'asset1',
			[{ date: new Date('2025-09-20'), value: 1.5, paymentType: 'JCP' }],
			{
				replaceRange: {
					from: new Date('2025-04-01'),
					to: new Date('2026-08-31'),
				},
			}
		);

		const datas = savedHistory.map(iso).sort();
		// 2024 fica: o extrato não afirma nada sobre aquele período.
		expect(datas).toEqual(['2024-03-10', '2025-09-20']);
	});

	it('inclui as bordas da janela na substituição', async () => {
		withExistingHistory([
			{ date: new Date('2025-04-01'), value: 2, paymentType: 'DIVIDEND' },
			{ date: new Date('2026-08-31'), value: 3, paymentType: 'DIVIDEND' },
		]);

		await service.upsertDividendHistoryEntries(
			'asset1',
			[{ date: new Date('2025-06-10'), value: 7, paymentType: 'DIVIDEND' }],
			{
				replaceRange: {
					from: new Date('2025-04-01'),
					to: new Date('2026-08-31'),
				},
			}
		);

		expect(savedHistory).toHaveLength(1);
		expect(iso(savedHistory[0])).toBe('2025-06-10');
	});

	it('devolve o histórico ordenado por data', async () => {
		withExistingHistory([]);

		await service.upsertDividendHistoryEntries('asset1', [
			{ date: new Date('2025-11-15'), value: 3, paymentType: 'DIVIDEND' },
			{ date: new Date('2025-01-15'), value: 1, paymentType: 'DIVIDEND' },
			{ date: new Date('2025-06-15'), value: 2, paymentType: 'DIVIDEND' },
		]);

		expect(savedHistory.map(iso)).toEqual([
			'2025-01-15',
			'2025-06-15',
			'2025-11-15',
		]);
	});
});
