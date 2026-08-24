import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { AssetsService } from 'src/assets/assets.service';
import { SubscriptionService } from 'src/subscription/subscription.service';

jest.mock('src/authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

describe('PortfolioController', () => {
	let controller: PortfolioController;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let portfolioService: PortfolioService;

	const mockPortfolioService = {
		createPortfolio: jest.fn(),
		getUserPortfolios: jest.fn(),
		findPortfolioById: jest.fn(),
		findOwnedPortfolioById: jest.fn(),
		assertPortfolioOwnership: jest.fn().mockResolvedValue(undefined),
		updatePortfolio: jest.fn(),
		deletePortfolio: jest.fn(),
		addAssetToPortfolio: jest.fn(),
	};

	/** Request autenticado mínimo — as rotas por id agora exigem o dono. */
	const reqFor = (userId = 'user1') => ({ user: { userId } }) as any;

	const mockAssetsService = {};

	const mockSubscriptionService = {
		findCurrentSubscriptionByUser: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [PortfolioController],
			providers: [
				{
					provide: PortfolioService,
					useValue: mockPortfolioService,
				},
				{
					provide: AssetsService,
					useValue: mockAssetsService,
				},
				{
					provide: SubscriptionService,
					useValue: mockSubscriptionService,
				},
			],
		}).compile();

		controller = module.get<PortfolioController>(PortfolioController);
		portfolioService = module.get<PortfolioService>(PortfolioService);
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});

	describe('create', () => {
		it('should create a new portfolio and return mapped response', async () => {
			const req = { user: { id: 'user1' } };
			const dto = { name: 'Test', cpf: '123', ownerType: 'self' as any };

			mockSubscriptionService.findCurrentSubscriptionByUser.mockResolvedValue({
				plan: { name: 'premium' },
			});
			mockPortfolioService.createPortfolio.mockResolvedValue({
				_id: 'port1',
				id: 'port1',
				userId: 'user1',
				name: 'Test',
				assets: [],
				plan: 'premium',
			});

			const result = await controller.create(dto as any, req);
			expect(result.id).toBe('port1');
			expect(mockPortfolioService.createPortfolio).toHaveBeenCalledWith(
				'user1',
				dto,
				'premium'
			);
		});
	});

	describe('update', () => {
		it('should update a portfolio and return response', async () => {
			const dto = { name: 'New Name' };
			mockPortfolioService.updatePortfolio.mockResolvedValue({
				_id: '1',
				id: '1',
				userId: 'user1',
				cpf: null,
				name: 'New Name',
				description: null,
				ownerType: 'self',
				ownerName: null,
				totalValue: 0,
				plan: 'premium',
				assets: [],
				syncedWithB3At: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			const result = await controller.update('1', dto as any, reqFor());
			expect(result.id).toBe('1');
			expect(result.name).toBe('New Name');
			expect(mockPortfolioService.updatePortfolio).toHaveBeenCalledWith(
				'1',
				dto
			);
		});
	});

	describe('delete', () => {
		it('should delete a portfolio', async () => {
			mockPortfolioService.deletePortfolio.mockResolvedValue({ id: '1' });
			await controller.delete('1', reqFor());
			expect(mockPortfolioService.deletePortfolio).toHaveBeenCalledWith('1');
		});

		it('não apaga a carteira quando ela não é do usuário do token', async () => {
			// Este spec não limpa mocks entre testes; o delete acima já registrou
			// uma chamada e o assert abaixo é sobre ESTA requisição.
			mockPortfolioService.deletePortfolio.mockClear();
			// assertPortfolioOwnership rejeita: o delete não pode nem ser chamado.
			mockPortfolioService.assertPortfolioOwnership.mockRejectedValueOnce(
				new NotFoundException('Carteira não encontrada.')
			);

			await expect(controller.delete('1', reqFor('outro'))).rejects.toThrow(
				NotFoundException
			);
			expect(mockPortfolioService.deletePortfolio).not.toHaveBeenCalled();
		});
	});
});
