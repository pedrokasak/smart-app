import { Test, TestingModule } from '@nestjs/testing';
import { AssetsService } from './assets.service';
import { NotFoundException } from '@nestjs/common';
import { DividendReceivedProducer } from './events/dividend-received.producer';

describe('AssetsService', () => {
	let service: AssetsService;

	// Mock do AssetModel
	const mockAssetModel = {
		find: jest.fn(),
		findById: jest.fn(),
		findOne: jest.fn(),
		create: jest.fn(),
		findByIdAndUpdate: jest.fn(),
		findByIdAndDelete: jest.fn(),
	};

	const mockPortfolioModel = {
		distinct: jest.fn(),
		exists: jest.fn(),
		findById: jest.fn(),
		findByIdAndUpdate: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AssetsService,
				{
					provide: 'AssetModel', // ou o nome correto do token
					useValue: mockAssetModel,
				},
				{
					provide: 'PortfolioModel',
					useValue: mockPortfolioModel,
				},
				// TRA-136: produtor do evento de provento.
				{
					provide: DividendReceivedProducer,
					useValue: { publishForAsset: jest.fn() },
				},
			],
		}).compile();

		service = module.get<AssetsService>(AssetsService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});

	describe('posse do ativo (TRA-211)', () => {
		const ownerId = '507f1f77bcf86cd799439011';
		const assetId = '507f1f77bcf86cd799439022';
		const portfolioId = '507f1f77bcf86cd799439033';

		beforeEach(() => jest.clearAllMocks());

		it('lista só ativos das carteiras do usuário', async () => {
			mockPortfolioModel.distinct.mockResolvedValue([portfolioId]);
			mockAssetModel.find.mockResolvedValue([]);

			await service.findAllForUser(ownerId);

			expect(mockPortfolioModel.distinct).toHaveBeenCalledWith('_id', {
				userId: ownerId,
			});
			expect(mockAssetModel.find).toHaveBeenCalledWith({
				portfolioId: { $in: [portfolioId] },
			});
		});

		it('devolve o ativo quando a carteira é do usuário', async () => {
			const asset = { _id: assetId, portfolioId };
			mockAssetModel.findById.mockResolvedValue(asset);
			mockPortfolioModel.exists.mockResolvedValue({ _id: portfolioId });

			await expect(service.findOwned(ownerId, assetId)).resolves.toBe(asset);
			expect(mockPortfolioModel.exists).toHaveBeenCalledWith({
				_id: portfolioId,
				userId: ownerId,
			});
		});

		it('ativo de outra pessoa responde 404', async () => {
			mockAssetModel.findById.mockResolvedValue({ _id: assetId, portfolioId });
			mockPortfolioModel.exists.mockResolvedValue(null);

			await expect(service.findOwned(ownerId, assetId)).rejects.toThrow(
				NotFoundException
			);
		});

		it('id inválido ou inexistente responde 404 sem consultar carteira', async () => {
			await expect(service.findOwned(ownerId, 'nao-e-id')).rejects.toThrow(
				NotFoundException
			);
			mockAssetModel.findById.mockResolvedValue(null);
			await expect(service.findOwned(ownerId, assetId)).rejects.toThrow(
				NotFoundException
			);
			expect(mockPortfolioModel.exists).not.toHaveBeenCalled();
		});
	});
});
