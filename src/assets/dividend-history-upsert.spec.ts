import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AssetsService } from './assets.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { DividendReceivedProducer } from './events/dividend-received.producer';

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
	// TRA-136: o upsert passou a publicar `portfolio.dividend.received` para
	// cada provento realmente novo. O dublê registra as chamadas para o teste
	// abaixo e garante que a publicação não interfere no merge.
	const dividendProducer = { publishForAsset: jest.fn() };

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
				{
					provide: DividendReceivedProducer,
					useValue: dividendProducer,
				},
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

	/**
	 * TRA-136: o evento afirma "recebi um provento", não "reimportei um
	 * arquivo". A mesma impressão digital que evita a duplicata no merge
	 * decide quem vira evento.
	 */
	it('publica evento só para o provento que ainda não existia', async () => {
		withExistingHistory([
			{ date: new Date('2025-09-20'), value: 1.5, paymentType: 'JCP' },
		]);

		await service.upsertDividendHistoryEntries('asset1', [
			{ date: new Date('2025-09-20'), value: 1.5, paymentType: 'JCP' },
			{ date: new Date('2025-10-20'), value: 2, paymentType: 'JCP' },
		]);

		expect(dividendProducer.publishForAsset).toHaveBeenCalledTimes(1);
		const [assetId, entries] = dividendProducer.publishForAsset.mock.calls[0];
		expect(assetId).toBe('asset1');
		expect(entries.map(iso)).toEqual(['2025-10-20']);
	});

	it('reimportar o mesmo extrato não publica nada', async () => {
		withExistingHistory([
			{ date: new Date('2025-09-20'), value: 1.5, paymentType: 'JCP' },
		]);

		await service.upsertDividendHistoryEntries('asset1', [
			{ date: new Date('2025-09-20'), value: 1.5, paymentType: 'JCP' },
		]);

		expect(dividendProducer.publishForAsset).not.toHaveBeenCalled();
	});
});
