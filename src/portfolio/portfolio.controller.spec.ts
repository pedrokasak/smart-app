import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { AssetsService } from 'src/assets/assets.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { TradeModel } from 'src/fiscal/schema/trade.model';

jest.mock('src/authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

jest.mock('src/fiscal/schema/trade.model', () => ({
	TradeModel: {
		find: jest.fn(),
	},
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

	describe('findById', () => {
		it('deriva o preço médio a partir das negociações quando o ativo não tem avgPrice gravado', async () => {
			// TRA-90: import de extrato B3 grava a negociação sem avgPrice, e
			// GET /portfolio/:id (a rota que quem tem uma única carteira usa
			// por padrão) nunca aplicava a mesma derivação de
			// GET /portfolio/assets — P&L ficava "—" mesmo com meses de
			// negociação importada.
			mockPortfolioService.findOwnedPortfolioById.mockResolvedValue({
				id: 'port1',
				userId: 'user1',
				cpf: null,
				name: 'Minha carteira',
				description: null,
				ownerType: 'self',
				ownerName: null,
				totalValue: 1000,
				plan: 'premium',
				assets: [
					{
						_id: 'asset1',
						portfolioId: 'port1',
						symbol: 'PETR4',
						type: 'stock',
						quantity: 100,
						price: 10,
						total: 1000,
						currentPrice: 10,
						change24h: 0,
						indicators: {},
						source: 'b3-import',
					},
				],
				syncedWithB3At: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			(TradeModel.find as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnValue({
					lean: jest.fn().mockResolvedValue([
						{
							symbol: 'PETR4',
							side: 'buy',
							quantity: 100,
							price: 8,
							fees: 0,
							date: new Date('2026-01-01'),
						},
					]),
				}),
			});

			const result = await controller.findById('port1', reqFor());

			expect(TradeModel.find).toHaveBeenCalledWith({ userId: 'user1' });
			expect(result.assets[0].avgPrice).toBe(8);
		});

		it('mantém o avgPrice já gravado no ativo em vez de recalcular', async () => {
			mockPortfolioService.findOwnedPortfolioById.mockResolvedValue({
				id: 'port1',
				userId: 'user1',
				cpf: null,
				name: 'Minha carteira',
				description: null,
				ownerType: 'self',
				ownerName: null,
				totalValue: 1000,
				plan: 'premium',
				assets: [
					{
						_id: 'asset1',
						portfolioId: 'port1',
						symbol: 'PETR4',
						type: 'stock',
						quantity: 100,
						price: 10,
						avgPrice: 9.5,
						total: 1000,
						currentPrice: 10,
						change24h: 0,
						indicators: {},
						source: 'manual',
					},
				],
				syncedWithB3At: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			(TradeModel.find as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnValue({
					lean: jest.fn().mockResolvedValue([]),
				}),
			});

			const result = await controller.findById('port1', reqFor());
			expect(result.assets[0].avgPrice).toBe(9.5);
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
