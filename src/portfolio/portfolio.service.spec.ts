import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioService } from './portfolio.service';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Portfolio } from './schema/portfolio.model';
import { PortfolioEnrichService } from './portfolio-enrich.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PlanQuotaService } from 'src/subscription/quotas/plan-quota.service';

describe('PortfolioService', () => {
	let service: PortfolioService;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let portfolioModel: Model<Portfolio>;

	const mockPortfolioModel = {
		create: jest.fn(),
		find: jest.fn(),
		findById: jest.fn(),
		findByIdAndUpdate: jest.fn(),
		findByIdAndDelete: jest.fn(),
		countDocuments: jest.fn(),
		deleteOne: jest.fn(),
		exists: jest.fn(),
	};

	const mockAssetModel = {
		create: jest.fn(),
		deleteOne: jest.fn(),
	};

	// Passa direto pela criação; a lógica da cota é testada em plan-quota.service.spec.
	const mockPlanQuota = {
		createWithinQuota: jest.fn<
			Promise<unknown>,
			[
				string,
				string,
				() => Promise<unknown>,
				(created: any) => Promise<unknown>,
			]
		>(async (_userId, _resource, create) => create()),
	};

	const mockPortfolioHistoryModel = {
		find: jest.fn(),
	};

	const mockPortfolioEnrichService = {
		enrichAsset: jest.fn(),
	};

	beforeEach(async () => {
		mockPlanQuota.createWithinQuota.mockClear();
		mockPortfolioModel.create.mockClear();
		mockPortfolioModel.deleteOne.mockClear();
		mockAssetModel.create.mockClear();
		mockAssetModel.deleteOne.mockClear();
		mockPortfolioEnrichService.enrichAsset.mockClear();
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				PortfolioService,
				{
					provide: getModelToken('Portfolio'),
					useValue: mockPortfolioModel,
				},
				{
					provide: getModelToken('PortfolioHistory'),
					useValue: mockPortfolioHistoryModel,
				},
				{
					provide: getModelToken('Asset'),
					useValue: mockAssetModel,
				},
				{
					provide: PortfolioEnrichService,
					useValue: mockPortfolioEnrichService,
				},
				{ provide: PlanQuotaService, useValue: mockPlanQuota },
			],
		}).compile();

		service = module.get<PortfolioService>(PortfolioService);
		portfolioModel = module.get<Model<Portfolio>>(getModelToken('Portfolio'));
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});

	describe('createPortfolio (cota do plano, TRA-197)', () => {
		const createDto = {
			name: 'My Portfolio',
			cpf: '123.456.789-00',
			ownerType: 'self' as any,
		};

		it('cria a carteira pela cota de carteiras do usuário', async () => {
			mockPortfolioModel.create.mockResolvedValue({ id: '1', ...createDto });

			const result = await service.createPortfolio('user1', createDto, 'Pro');

			expect(mockPlanQuota.createWithinQuota).toHaveBeenCalledWith(
				'user1',
				'portfolios',
				expect.any(Function),
				expect.any(Function)
			);
			expect(mockPortfolioModel.create).toHaveBeenCalledWith(
				expect.objectContaining({ userId: 'user1', plan: 'Pro' })
			);
			expect(result).toMatchObject({ id: '1' });
		});

		it('o nome do plano não decide o limite: quem assina o gratuito também passa pela cota', async () => {
			mockPortfolioModel.create.mockResolvedValue({ id: '1', ...createDto });

			await service.createPortfolio('user1', createDto, 'Essencial');

			expect(mockPlanQuota.createWithinQuota).toHaveBeenCalledWith(
				'user1',
				'portfolios',
				expect.any(Function),
				expect.any(Function)
			);
		});

		it('recusa quando a cota estoura, sem criar nada', async () => {
			mockPlanQuota.createWithinQuota.mockRejectedValueOnce(
				new ForbiddenException('cota')
			);

			await expect(
				service.createPortfolio('user1', createDto, 'free')
			).rejects.toThrow(ForbiddenException);
			expect(mockPortfolioModel.create).not.toHaveBeenCalled();
		});

		it('desfazer a carteira que estourou a cota apaga só ela', async () => {
			mockPortfolioModel.create.mockResolvedValue({
				_id: 'nova',
				...createDto,
			});
			await service.createPortfolio('user1', createDto, 'free');

			const undo = mockPlanQuota.createWithinQuota.mock.calls[0][3];
			await undo({ _id: 'nova' });

			expect(mockPortfolioModel.deleteOne).toHaveBeenCalledWith({
				_id: 'nova',
			});
		});
	});

	describe('addAssetToPortfolio (cota do plano, TRA-197)', () => {
		const assetDto = {
			symbol: 'PETR4',
			type: 'stock' as any,
			quantity: 10,
			price: 30,
		};

		function ownerIs(userId: string | null) {
			mockPortfolioModel.findById.mockReturnValue({
				select: () => ({
					lean: () => Promise.resolve(userId ? { userId } : null),
				}),
			});
		}

		it('conta o ativo na cota do DONO da carteira', async () => {
			ownerIs('dono-1');
			mockAssetModel.create.mockResolvedValue({ _id: 'a1' });
			mockPortfolioEnrichService.enrichAsset.mockResolvedValue({ _id: 'a1' });
			mockPortfolioModel.findByIdAndUpdate.mockResolvedValue({});
			jest
				.spyOn(service as any, 'recordHistorySnapshot')
				.mockResolvedValue(undefined);

			await service.addAssetToPortfolio('carteira-1', assetDto);

			expect(mockPlanQuota.createWithinQuota).toHaveBeenCalledWith(
				'dono-1',
				'assets',
				expect.any(Function),
				expect.any(Function)
			);
		});

		it('carteira inexistente não cria ativo órfão', async () => {
			ownerIs(null);

			await expect(
				service.addAssetToPortfolio('fantasma', assetDto)
			).rejects.toThrow(NotFoundException);
			expect(mockAssetModel.create).not.toHaveBeenCalled();
		});

		it('cota estourada interrompe antes de enriquecer o ativo', async () => {
			ownerIs('dono-1');
			mockPlanQuota.createWithinQuota.mockRejectedValueOnce(
				new ForbiddenException('cota')
			);

			await expect(
				service.addAssetToPortfolio('carteira-1', assetDto)
			).rejects.toThrow(ForbiddenException);
			expect(mockPortfolioEnrichService.enrichAsset).not.toHaveBeenCalled();
		});

		it('desfazer o ativo que estourou a cota apaga só ele', async () => {
			ownerIs('dono-1');
			mockAssetModel.create.mockResolvedValue({ _id: 'a1' });
			mockPortfolioEnrichService.enrichAsset.mockResolvedValue({ _id: 'a1' });
			mockPortfolioModel.findByIdAndUpdate.mockResolvedValue({});
			jest
				.spyOn(service as any, 'recordHistorySnapshot')
				.mockResolvedValue(undefined);
			await service.addAssetToPortfolio('carteira-1', assetDto);

			const undo = mockPlanQuota.createWithinQuota.mock.calls[0][3];
			await undo({ _id: 'a1' });

			expect(mockAssetModel.deleteOne).toHaveBeenCalledWith({ _id: 'a1' });
		});
	});

	describe('updatePortfolio', () => {
		it('should update the portfolio', async () => {
			const updateDto = { name: 'Updated Name' };
			mockPortfolioModel.findByIdAndUpdate.mockResolvedValue({
				id: '1',
				...updateDto,
			});

			const result = await service.updatePortfolio('1', updateDto);
			expect(mockPortfolioModel.findByIdAndUpdate).toHaveBeenCalledWith(
				'1',
				updateDto,
				{ new: true }
			);
			expect(result.name).toBe('Updated Name');
		});

		it('should throw NotFoundException if portfolio not found on update', async () => {
			mockPortfolioModel.findByIdAndUpdate.mockResolvedValue(null);

			await expect(
				service.updatePortfolio('invalid_id', { name: 'Test' })
			).rejects.toThrow(NotFoundException);
		});
	});

	describe('deletePortfolio', () => {
		it('should delete the portfolio', async () => {
			mockPortfolioModel.findByIdAndDelete.mockResolvedValue({ id: '1' });
			await service.deletePortfolio('1');
			expect(mockPortfolioModel.findByIdAndDelete).toHaveBeenCalledWith('1');
		});

		it('should throw NotFoundException if portfolio not found on delete', async () => {
			mockPortfolioModel.findByIdAndDelete.mockResolvedValue(null);

			await expect(service.deletePortfolio('invalid_id')).rejects.toThrow(
				NotFoundException
			);
		});
	});

	describe('getUserPortfolioHistory', () => {
		function mockFindResult(rows: Array<{ date: string; totalValue: number }>) {
			mockPortfolioHistoryModel.find.mockReturnValue({
				sort: jest.fn().mockReturnValue({
					exec: jest.fn().mockResolvedValue(rows),
				}),
			});
		}

		it('soma totalValue de portfólios diferentes no mesmo dia', async () => {
			mockFindResult([
				{ date: '2026-08-10', totalValue: 1000 },
				{ date: '2026-08-10', totalValue: 500 },
				{ date: '2026-08-11', totalValue: 1600 },
			]);

			const result = await service.getUserPortfolioHistory(
				'user-1',
				'2026-08-10',
				'2026-08-11'
			);

			expect(result).toEqual([
				{ date: '2026-08-10', totalValue: 1500 },
				{ date: '2026-08-11', totalValue: 1600 },
			]);
		});

		it('devolve array vazio quando não há snapshot no período', async () => {
			mockFindResult([]);

			const result = await service.getUserPortfolioHistory(
				'user-1',
				'2026-08-10',
				'2026-08-11'
			);

			expect(result).toEqual([]);
		});

		it('filtra por userId e pela janela de datas via query', async () => {
			mockFindResult([]);

			await service.getUserPortfolioHistory(
				'user-9',
				'2026-08-01',
				'2026-08-07'
			);

			expect(mockPortfolioHistoryModel.find).toHaveBeenCalledWith({
				userId: 'user-9',
				date: { $gte: '2026-08-01', $lte: '2026-08-07' },
			});
		});
	});
});
