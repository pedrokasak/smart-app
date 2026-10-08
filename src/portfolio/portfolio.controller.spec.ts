import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { PlanQuotaService } from 'src/subscription/quotas/plan-quota.service';
import { AssetsService } from 'src/assets/assets.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { PortfolioReturnsService } from 'src/portfolio/returns/portfolio-returns.service';
import { PortfolioCompositionService } from 'src/portfolio/composition/portfolio-composition.service';
import { PortfolioRiskContributionService } from 'src/portfolio/risk/portfolio-risk-contribution.service';
import { PortfolioHistoryBackfillService } from 'src/portfolio/history/portfolio-history-backfill.service';
import { UpcomingDividendsService } from 'src/portfolio/upcoming-dividends/upcoming-dividends.service';
import { QUOTE_FRESHNESS_STORE } from 'src/market-data/quote-staleness/application/ports/quote-freshness.port';
import { TradeModel } from 'src/fiscal/schema/trade.model';
import * as xlsx from 'xlsx';
import { BrokerageNoteUploadModel } from 'src/broker-sync/schema/brokerage-note-upload.model';
import { extractPdfText } from 'src/common/pdf/extract-pdf-text';

jest.mock('src/authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

jest.mock('src/broker-sync/schema/brokerage-note-upload.model', () => ({
	BrokerageNoteUploadModel: { create: jest.fn().mockResolvedValue({}) },
}));

jest.mock('src/common/pdf/extract-pdf-text', () => ({
	extractPdfText: jest.fn(),
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

	const mockPortfolioReturnsService = {
		getReturns: jest.fn(),
	};

	const mockPortfolioCompositionService = {
		getComposition: jest.fn(),
	};

	const mockPortfolioRiskContributionService = {
		getRiskContribution: jest.fn(),
	};

	const mockPortfolioHistoryBackfillService = {
		backfill: jest.fn(),
	};

	const mockPlanQuota = {
		assertCanAdd: jest.fn().mockResolvedValue(undefined),
	};

	const mockQuoteFreshness = {
		findBySymbols: jest.fn().mockResolvedValue([]),
		recordReads: jest.fn(),
	};
	const mockUpcomingDividendsService = {
		replaceForPortfolio: jest.fn(),
		listUpcoming: jest.fn(),
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
				{ provide: PlanQuotaService, useValue: mockPlanQuota },
				{
					provide: SubscriptionService,
					useValue: mockSubscriptionService,
				},
				{
					provide: PortfolioReturnsService,
					useValue: mockPortfolioReturnsService,
				},
				{
					provide: PortfolioCompositionService,
					useValue: mockPortfolioCompositionService,
				},
				{
					provide: PortfolioRiskContributionService,
					useValue: mockPortfolioRiskContributionService,
				},
				{
					provide: PortfolioHistoryBackfillService,
					useValue: mockPortfolioHistoryBackfillService,
				},
				{
					provide: UpcomingDividendsService,
					useValue: mockUpcomingDividendsService,
				},
				{
					provide: QUOTE_FRESHNESS_STORE,
					useValue: mockQuoteFreshness,
				},
			],
		}).compile();

		controller = module.get<PortfolioController>(PortfolioController);
		portfolioService = module.get<PortfolioService>(PortfolioService);
	});

	// Quem importou notas antes de a reconstrução existir precisa de um
	// gatilho manual; a rota exige ser dono do portfólio.
	it('reconstrói o histórico do portfólio do dono', async () => {
		const payload = { covered: true, written: 180 };
		mockPortfolioHistoryBackfillService.backfill.mockResolvedValue(payload);

		await expect(
			controller.backfillHistory('p1', reqFor('user7'))
		).resolves.toBe(payload);
		expect(mockPortfolioService.assertPortfolioOwnership).toHaveBeenCalledWith(
			'user7',
			'p1'
		);
		expect(mockPortfolioHistoryBackfillService.backfill).toHaveBeenCalledWith({
			userId: 'user7',
			portfolioId: 'p1',
		});
	});

	it('entrega a contribuição de risco do usuário autenticado', async () => {
		const payload = { rows: [], observations: 0 };
		mockPortfolioRiskContributionService.getRiskContribution.mockResolvedValue(
			payload
		);

		await expect(controller.getRiskContribution(reqFor('user9'))).resolves.toBe(
			payload
		);
		expect(
			mockPortfolioRiskContributionService.getRiskContribution
		).toHaveBeenCalledWith('user9');
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

	describe('importB3Report — cota de ativos (TRA-197)', () => {
		const stockSheet = (symbols: string[]) => {
			const workbook = xlsx.utils.book_new();
			xlsx.utils.book_append_sheet(
				workbook,
				xlsx.utils.aoa_to_sheet([
					[
						'CNPJ da Empresa',
						'Código de Negociação',
						'Quantidade',
						'Preço de Fechamento',
						'Valor Atualizado',
					],
					...symbols.map((symbol) => [
						'00.000.000/0001-00',
						symbol,
						10,
						20,
						200,
					]),
				]),
				'Acoes'
			);
			return {
				originalname: 'posicao-2026-09-14-09-56-05.xlsx',
				mimetype:
					'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
			};
		};

		beforeEach(() => {
			mockPlanQuota.assertCanAdd.mockClear();
			mockPortfolioService.addAssetToPortfolio = jest.fn();
			(mockAssetsService as any).findAssetBySymbolAndPortfolio = jest.fn();
		});

		it('confere a cota com o número de ativos NOVOS antes de gravar qualquer um', async () => {
			// PETR4 já existe na carteira; VALE3 e ITUB4 são novos.
			(
				mockAssetsService as any
			).findAssetBySymbolAndPortfolio.mockImplementation(
				async (_id: string, symbol: string) =>
					symbol === 'PETR4' ? { _id: 'a1' } : null
			);
			mockPlanQuota.assertCanAdd.mockRejectedValueOnce(
				new ForbiddenException('cota')
			);

			await expect(
				controller.importB3Report(
					'carteira-1',
					stockSheet(['PETR4', 'VALE3', 'ITUB4']),
					reqFor('user1')
				)
			).rejects.toThrow(ForbiddenException);

			expect(mockPlanQuota.assertCanAdd).toHaveBeenCalledWith(
				'user1',
				'assets',
				2
			);
			expect(mockPortfolioService.addAssetToPortfolio).not.toHaveBeenCalled();
		});

		it('relatório só com ativos que já existem não consome cota', async () => {
			(
				mockAssetsService as any
			).findAssetBySymbolAndPortfolio.mockResolvedValue({
				_id: 'a1',
			});
			(mockAssetsService as any).update = jest.fn().mockResolvedValue(null);
			(mockAssetsService as any).upsertDividendHistoryEntries = jest.fn();

			await controller
				.importB3Report('carteira-1', stockSheet(['PETR4']), reqFor('user1'))
				.catch(() => undefined);

			expect(mockPlanQuota.assertCanAdd).toHaveBeenCalledWith(
				'user1',
				'assets',
				0
			);
		});
	});

	describe('import-b3-auto', () => {
		const xlsxUpload = (sheetName: string, rows: any[][]) => {
			const workbook = xlsx.utils.book_new();
			xlsx.utils.book_append_sheet(
				workbook,
				xlsx.utils.aoa_to_sheet(rows),
				sheetName
			);
			return {
				originalname: 'eventos-2026-09-14-09-56-05.xlsx',
				mimetype:
					'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
			};
		};

		it('routes the B3 "Eventos" report to the pending-dividends list, never to the received-dividends importer', async () => {
			const file = xlsxUpload('Proventos a Receber', [
				[
					'Produto',
					'Tipo',
					'Tipo de Evento',
					'Previsão de pagamento',
					'Instituição',
					'Conta',
					'Quantidade',
					'Preço unitário',
					'Valor líquido',
				],
				[
					'MOVI3 - MOVIDA',
					'ON',
					'DIVIDENDO',
					'11/09/2026',
					'BTG',
					'1',
					'32',
					0.53,
					14.39,
				],
			]);
			mockUpcomingDividendsService.replaceForPortfolio.mockResolvedValue({
				eventsImported: 1,
				totalNetValue: 14.39,
				nextPaymentDate: new Date('2026-09-11'),
			});
			const reportSpy = jest.spyOn(controller, 'importB3Report');
			const transactionsSpy = jest.spyOn(controller, 'importB3Transactions');

			const result: any = await controller.importB3Auto(
				'507f1f77bcf86cd799439012',
				file,
				reqFor('507f1f77bcf86cd799439011')
			);

			expect(
				mockPortfolioService.assertPortfolioOwnership
			).toHaveBeenCalledWith(
				'507f1f77bcf86cd799439011',
				'507f1f77bcf86cd799439012'
			);
			expect(result).toMatchObject({ kind: 'upcoming', eventsImported: 1 });
			const [userId, portfolioId, events] =
				mockUpcomingDividendsService.replaceForPortfolio.mock.calls[0];
			expect([userId, portfolioId]).toEqual([
				'507f1f77bcf86cd799439011',
				'507f1f77bcf86cd799439012',
			]);
			expect(events[0]).toMatchObject({ symbol: 'MOVI3', netValue: 14.39 });
			expect(reportSpy).not.toHaveBeenCalled();
			expect(transactionsSpy).not.toHaveBeenCalled();
			expect(BrokerageNoteUploadModel.create).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: 'b3_events',
					status: 'processed',
					originalName: 'eventos-2026-09-14-09-56-05.xlsx',
				})
			);
		});

		const pdfUpload = (name: string) => ({
			originalname: name,
			mimetype: 'application/pdf',
			buffer: Buffer.from(['%PDF-1.7', '%fake'].join(String.fromCharCode(10))),
			size: 20,
		});

		it('hands non-B3 PDFs back with NOT_B3_PDF so the web sends them to the note parser', async () => {
			(extractPdfText as jest.Mock).mockResolvedValue(
				'NOTA DE NEGOCIAÇÃO BTG PACTUAL'
			);

			await expect(
				controller.importB3Auto(
					'507f1f77bcf86cd799439012',
					pdfUpload('nota.pdf'),
					reqFor('507f1f77bcf86cd799439011')
				)
			).rejects.toMatchObject({ response: { code: 'NOT_B3_PDF' } });
		});

		it('records a clear failure for B3 PDFs that only work in Excel', async () => {
			(extractPdfText as jest.Mock).mockResolvedValue(
				[
					'Filtros aplicados',
					'Extrato de Movimentação',
					'acesse investidor.B3.com.br',
				].join(String.fromCharCode(10))
			);

			await expect(
				controller.importB3Auto(
					'507f1f77bcf86cd799439012',
					pdfUpload('movimentacao.pdf'),
					reqFor('507f1f77bcf86cd799439011')
				)
			).rejects.toThrow(/Excel/);
			expect(BrokerageNoteUploadModel.create).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'failed',
					originalName: 'movimentacao.pdf',
				})
			);
		});
	});

	// TRA-247: a carteira mostrava o fechamento do relatório, não a cotação.
	describe('GET /portfolio/assets — marcação a mercado', () => {
		it('usa a última cotação do cache para preço e valor da posição', async () => {
			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{
					assets: [
						{
							_id: 'a1',
							portfolioId: 'p1',
							symbol: 'VBBR3',
							type: 'stock',
							quantity: 73.9,
							price: 25.33,
							total: 1872.03,
							currentPrice: null,
							source: 'b3',
						},
					],
				},
			]);
			(TradeModel.find as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnValue({
					lean: jest.fn().mockResolvedValue([]),
				}),
			});
			mockQuoteFreshness.findBySymbols.mockResolvedValue([
				{
					symbol: 'VBBR3',
					lastQuoteAt: new Date('2026-09-26T11:49:00Z'),
					lastPrice: 37.21,
					source: 'primary',
				},
			]);

			const [asset] = await controller.findAllAssets({
				user: { userId: 'u1' },
			});

			expect(mockQuoteFreshness.findBySymbols).toHaveBeenCalledWith(['VBBR3']);
			expect(asset.currentPrice).toBe(37.21);
			expect(asset.total).toBe(2749.82);
			expect(asset.quoteAsOf).toBe('2026-09-26T11:49:00.000Z');
		});

		it('se o cache falha, devolve a carteira com o preço gravado', async () => {
			mockPortfolioService.getUserPortfolios.mockResolvedValue([
				{
					assets: [
						{
							_id: 'a1',
							portfolioId: 'p1',
							symbol: 'VBBR3',
							type: 'stock',
							quantity: 10,
							price: 20,
							total: 200,
							source: 'b3',
						},
					],
				},
			]);
			(TradeModel.find as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnValue({
					lean: jest.fn().mockResolvedValue([]),
				}),
			});
			mockQuoteFreshness.findBySymbols.mockRejectedValue(
				new Error('mongo fora')
			);

			const [asset] = await controller.findAllAssets({
				user: { userId: 'u1' },
			});

			expect(asset.total).toBe(200);
		});
	});
});
