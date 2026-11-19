import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AiService } from 'src/ai/ai.service';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { FiscalController } from 'src/fiscal/fiscal.controller';
import { FiscalService } from 'src/fiscal/fiscal.service';
import { IrReportService } from 'src/fiscal/services/ir-report.service';
import { PortfolioReportService } from 'src/fiscal/services/portfolio-report.service';
import { PortfolioModel } from 'src/portfolio/schema/portfolio.model';
import { StockService } from 'src/stocks/stocks.service';

/**
 * TRA-285: o body do sale-preview era um tipo inline, sem class-validator.
 * Com o `SalePreviewDto`, valor fora do teto ou do tipo vira 400 antes de
 * qualquer consulta ao banco.
 */
describe('POST /fiscal/sale-preview — validação do body (TRA-285)', () => {
	let app: INestApplication;
	const userId = '64b7f0c2a1b2c3d4e5f60718';
	const findPortfolios = jest.spyOn(PortfolioModel, 'find');

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			controllers: [FiscalController],
			providers: [
				{ provide: IrReportService, useValue: {} },
				{ provide: FiscalService, useValue: {} },
				{ provide: StockService, useValue: {} },
				{ provide: PortfolioReportService, useValue: {} },
				{ provide: AiService, useValue: {} },
			],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({
				canActivate: (context: any) => {
					context.switchToHttp().getRequest().user = { userId };
					return true;
				},
			})
			.compile();

		app = moduleRef.createNestApplication();
		// Mesma configuração do ValidationPipe global (main.ts).
		app.useGlobalPipes(
			new ValidationPipe({
				whitelist: true,
				forbidNonWhitelisted: true,
				transform: true,
			})
		);
		await app.init();
	});

	beforeEach(() => {
		findPortfolios.mockReset();
		findPortfolios.mockReturnValue({
			select: () => ({ lean: () => Promise.resolve([]) }),
		} as any);
	});

	afterAll(async () => {
		findPortfolios.mockRestore();
		await app.close();
	});

	const valid = { symbol: 'PETR4', quantity: 100, sellPrice: 38.5 };

	it('body válido passa pela validação e mantém o contrato de resposta', async () => {
		const response = await request(app.getHttpServer())
			.post('/fiscal/sale-preview')
			.send(valid)
			.expect(201);

		expect(response.body).toMatchObject({
			symbol: 'PETR4',
			quantity: 100,
			sellPrice: 38.5,
			estimatedTax: 0,
			message: 'Nenhuma carteira encontrada para o usuário.',
		});
		expect(findPortfolios).toHaveBeenCalledTimes(1);
	});

	it.each([
		['preço de venda acima do teto', { ...valid, sellPrice: 1e12 }],
		['quantidade acima do teto', { ...valid, quantity: 1e13 }],
		['preço zero', { ...valid, sellPrice: 0 }],
		['quantidade negativa', { ...valid, quantity: -1 }],
		['preço como texto', { ...valid, sellPrice: '38,50' }],
		['sem símbolo', { quantity: 100, sellPrice: 38.5 }],
		['carteira com id inválido', { ...valid, portfolioId: 'todas' }],
		['campo desconhecido', { ...valid, userId: 'outro-usuario' }],
	])('%s: 400 sem consultar o banco', async (_label, body) => {
		await request(app.getHttpServer())
			.post('/fiscal/sale-preview')
			.send(body)
			.expect(400);

		expect(findPortfolios).not.toHaveBeenCalled();
	});
});
