import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioDigestBuilderService } from './portfolio-digest-builder.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { PortfolioErrorRadarService } from 'src/intelligence/application/portfolio-error-radar.service';

function asset(overrides: Record<string, any> = {}) {
	return {
		symbol: 'PETR4',
		type: 'stock',
		quantity: 100,
		price: 30,
		total: 3000,
		sector: 'Petroleo',
		...overrides,
	};
}

describe('PortfolioDigestBuilderService', () => {
	let service: PortfolioDigestBuilderService;
	const mockPortfolioService = {
		getUserPortfolios: jest.fn(),
		getUserPortfolioHistory: jest.fn(),
	};
	const mockPortfolioErrorRadarService = {
		detect: jest.fn(),
	};

	beforeEach(async () => {
		jest.clearAllMocks();
		mockPortfolioErrorRadarService.detect.mockReturnValue({
			modelVersion: 'portfolio_error_radar_v1',
			status: 'ok',
			riskLevel: 'low',
			alerts: [],
			positionsCount: 1,
		});
		mockPortfolioService.getUserPortfolioHistory.mockResolvedValue([]);

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				PortfolioDigestBuilderService,
				{ provide: PortfolioService, useValue: mockPortfolioService },
				{
					provide: PortfolioErrorRadarService,
					useValue: mockPortfolioErrorRadarService,
				},
			],
		}).compile();

		service = module.get<PortfolioDigestBuilderService>(
			PortfolioDigestBuilderService
		);
	});

	describe('carteira vazia', () => {
		it('devolve hasSufficientData false e tudo mais null/vazio', async () => {
			mockPortfolioService.getUserPortfolios.mockResolvedValue([]);

			const facts = await service.build('user-1');

			expect(facts.hasSufficientData).toBe(false);
			expect(facts.portfolioValue).toBeNull();
			expect(facts.periodChangePct).toBeNull();
			expect(facts.dividendsReceived).toBeNull();
			expect(facts.topGainers).toEqual([]);
			expect(facts.watchItems).toEqual([]);
		});
	});

	describe('sem snapshot inicial no periodo', () => {
		it('periodChangePct/Abs ficam null quando nao ha historico', async () => {
			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{ assets: [asset()] },
			]);
			mockPortfolioService.getUserPortfolioHistory.mockResolvedValue([]);

			const facts = await service.build('user-1');

			expect(facts.hasSufficientData).toBe(true);
			expect(facts.portfolioValue).toBe(3000);
			expect(facts.periodChangePct).toBeNull();
			expect(facts.periodChangeAbs).toBeNull();
		});

		it('calcula variacao real quando ha snapshot inicial', async () => {
			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{ assets: [asset({ total: 3300 })] },
			]);
			mockPortfolioService.getUserPortfolioHistory.mockResolvedValue([
				{ date: '2026-08-11', totalValue: 3000 },
			]);

			const facts = await service.build('user-1');

			expect(facts.periodChangeAbs).toBe(300);
			expect(facts.periodChangePct).toBe(10);
		});
	});

	describe('movers', () => {
		it('separa ganhadores e perdedores por change24h, ate 3 cada, ordenados', async () => {
			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{
					assets: [
						asset({ symbol: 'AAA3', change24h: 5 }),
						asset({ symbol: 'BBB3', change24h: 2 }),
						asset({ symbol: 'CCC3', change24h: -1 }),
						asset({ symbol: 'DDD3', change24h: -8 }),
						asset({ symbol: 'EEE3', change24h: 0 }),
					],
				},
			]);

			const facts = await service.build('user-1');

			expect(facts.topGainers.map((m) => m.symbol)).toEqual(['AAA3', 'BBB3']);
			expect(facts.topLosers.map((m) => m.symbol)).toEqual(['DDD3', 'CCC3']);
		});

		it('ignora ativos sem change24h numerico, nao trata como 0', async () => {
			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{ assets: [asset({ change24h: undefined })] },
			]);

			const facts = await service.build('user-1');

			expect(facts.topGainers).toEqual([]);
			expect(facts.topLosers).toEqual([]);
		});
	});

	describe('watch items — concentracao', () => {
		it('inclui alerta ASSET_CONCENTRATION_HIGH do radar como watch item', async () => {
			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{ assets: [asset()] },
			]);
			mockPortfolioErrorRadarService.detect.mockReturnValue({
				modelVersion: 'portfolio_error_radar_v1',
				status: 'ok',
				riskLevel: 'high',
				alerts: [
					{
						code: 'ASSET_CONCENTRATION_HIGH',
						type: 'concentration',
						severity: 'high',
						message: 'PETR4 representa 100.0% da carteira.',
						symbol: 'PETR4',
					},
				],
				positionsCount: 1,
			});

			const facts = await service.build('user-1');

			expect(facts.watchItems).toContainEqual({
				symbol: 'PETR4',
				reason: 'concentration_above_threshold',
				detail: 'PETR4 representa 100.0% da carteira.',
			});
		});

		it('ignora ASSET_CONCENTRATION_MEDIUM — so a severidade alta vira watch item', async () => {
			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{ assets: [asset()] },
			]);
			mockPortfolioErrorRadarService.detect.mockReturnValue({
				modelVersion: 'portfolio_error_radar_v1',
				status: 'ok',
				riskLevel: 'medium',
				alerts: [
					{
						code: 'ASSET_CONCENTRATION_MEDIUM',
						type: 'concentration',
						severity: 'medium',
						message: 'PETR4 representa 25.0% da carteira.',
						symbol: 'PETR4',
					},
				],
				positionsCount: 1,
			});

			const facts = await service.build('user-1');

			expect(facts.watchItems).toEqual([]);
		});
	});

	describe('watch items — custo medio', () => {
		it('inclui ativo mais de 5% abaixo do preco medio', async () => {
			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{
					assets: [asset({ symbol: 'XPTO3', avgPrice: 100, currentPrice: 90 })],
				},
			]);

			const facts = await service.build('user-1');

			expect(facts.watchItems).toContainEqual({
				symbol: 'XPTO3',
				reason: 'below_average_cost',
				detail: 'XPTO3 está 10.0% abaixo do preço médio.',
			});
		});

		it('nao emite watch item para oscilacao pequena (menos de 5%)', async () => {
			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{
					assets: [asset({ symbol: 'XPTO3', avgPrice: 100, currentPrice: 97 })],
				},
			]);

			const facts = await service.build('user-1');

			expect(facts.watchItems).toEqual([]);
		});

		it('nao emite watch item sem avgPrice ou currentPrice', async () => {
			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{ assets: [asset({ avgPrice: undefined, currentPrice: undefined })] },
			]);

			const facts = await service.build('user-1');

			expect(facts.watchItems).toEqual([]);
		});

		it('limita watchItems a 3 no total', async () => {
			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{
					assets: [
						asset({ symbol: 'A1', avgPrice: 100, currentPrice: 50 }),
						asset({ symbol: 'A2', avgPrice: 100, currentPrice: 60 }),
						asset({ symbol: 'A3', avgPrice: 100, currentPrice: 70 }),
						asset({ symbol: 'A4', avgPrice: 100, currentPrice: 80 }),
					],
				},
			]);

			const facts = await service.build('user-1');

			expect(facts.watchItems).toHaveLength(3);
		});
	});

	describe('dividendos', () => {
		it('soma apenas eventos dentro do periodo', async () => {
			const now = new Date();
			const withinPeriod = new Date(now);
			withinPeriod.setDate(withinPeriod.getDate() - 2);
			const outsidePeriod = new Date(now);
			outsidePeriod.setDate(outsidePeriod.getDate() - 30);

			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{
					assets: [
						asset({
							dividendHistory: [
								{ date: withinPeriod, value: 50 },
								{ date: outsidePeriod, value: 999 },
							],
						}),
					],
				},
			]);

			const facts = await service.build('user-1');

			expect(facts.dividendsReceived).toBe(50);
		});

		it('devolve null quando nenhum ativo tem dividendHistory', async () => {
			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{ assets: [asset({ dividendHistory: undefined })] },
			]);

			const facts = await service.build('user-1');

			expect(facts.dividendsReceived).toBeNull();
		});

		it('devolve 0 (nao null) quando ha historico mas nada no periodo', async () => {
			const longAgo = new Date();
			longAgo.setFullYear(longAgo.getFullYear() - 1);

			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{
					assets: [asset({ dividendHistory: [{ date: longAgo, value: 10 }] })],
				},
			]);

			const facts = await service.build('user-1');

			expect(facts.dividendsReceived).toBe(0);
		});
	});

	describe('determinismo', () => {
		it('mesma entrada produz exatamente a mesma saida', async () => {
			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{ assets: [asset()] },
			]);

			const a = await service.build('user-1');
			const b = await service.build('user-1');

			expect(a).toEqual(b);
		});
	});
});
