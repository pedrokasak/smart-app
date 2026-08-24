import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioService } from './portfolio.service';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Portfolio } from './schema/portfolio.model';
import { PortfolioEnrichService } from './portfolio-enrich.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

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
	};

	const mockPortfolioHistoryModel = {
		find: jest.fn(),
	};

	const mockPortfolioEnrichService = {
		enrichAsset: jest.fn(),
	};

	beforeEach(async () => {
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
			],
		}).compile();

		service = module.get<PortfolioService>(PortfolioService);
		portfolioModel = module.get<Model<Portfolio>>(getModelToken('Portfolio'));
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});

	describe('createPortfolio', () => {
		const createDto = {
			name: 'My Portfolio',
			cpf: '123.456.789-00',
			ownerType: 'self' as any,
		};

		it('should create a portfolio if user is free and has 0 portfolios', async () => {
			// A contagem acontece DEPOIS da escrita: com uma carteira só, é a
			// que acabou de ser criada.
			mockPortfolioModel.countDocuments.mockResolvedValue(1);
			mockPortfolioModel.create.mockResolvedValue({ id: '1', ...createDto });

			const result = await service.createPortfolio('user1', createDto, 'free');
			expect(result).toBeDefined();
			expect(mockPortfolioModel.create).toHaveBeenCalled();
		});

		it('should throw ForbiddenException if user is free and has 1 or more portfolios', async () => {
			mockPortfolioModel.create.mockResolvedValue({
				_id: 'nova',
				...createDto,
			});
			// Já existia uma; com a recém-criada são duas.
			mockPortfolioModel.countDocuments.mockResolvedValue(2);

			await expect(
				service.createPortfolio('user1', createDto, 'free')
			).rejects.toThrow(ForbiddenException);
		});

		it('desfaz a carteira que estourou o limite numa corrida (TRA-89)', async () => {
			// Duas requisições simultâneas contavam zero antes de qualquer uma
			// gravar e as duas passavam. Contando depois da escrita, a segunda
			// enxerga as duas e remove a própria.
			mockPortfolioModel.create.mockResolvedValue({
				_id: 'nova',
				...createDto,
			});
			mockPortfolioModel.countDocuments.mockResolvedValue(2);

			await expect(
				service.createPortfolio('user1', createDto, 'free')
			).rejects.toThrow(ForbiddenException);

			expect(mockPortfolioModel.deleteOne).toHaveBeenCalledWith({
				_id: 'nova',
			});
		});

		it('should create a portfolio if user is premium and has multiple portfolios', async () => {
			mockPortfolioModel.countDocuments.mockResolvedValue(5);
			mockPortfolioModel.create.mockResolvedValue({ id: '2', ...createDto });

			const result = await service.createPortfolio(
				'user1',
				createDto,
				'premium'
			);
			expect(result).toBeDefined();
			expect(mockPortfolioModel.create).toHaveBeenCalled();
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

			await service.getUserPortfolioHistory('user-9', '2026-08-01', '2026-08-07');

			expect(mockPortfolioHistoryModel.find).toHaveBeenCalledWith({
				userId: 'user-9',
				date: { $gte: '2026-08-01', $lte: '2026-08-07' },
			});
		});
	});
});
