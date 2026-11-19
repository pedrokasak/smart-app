import { Test, TestingModule } from '@nestjs/testing';
import { TaxEngineService } from 'src/fiscal/tax-engine/application/tax-engine.service';
import { PortfolioErrorRadarService } from './portfolio-error-radar.service';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';

function position(
	overrides: Partial<PortfolioIntelligencePosition> = {}
): PortfolioIntelligencePosition {
	return {
		symbol: 'PETR4',
		assetType: 'stock',
		quantity: 100,
		totalValue: 1000,
		sector: 'Petroleo',
		...overrides,
	} as PortfolioIntelligencePosition;
}

describe('PortfolioErrorRadarService', () => {
	let service: PortfolioErrorRadarService;
	const simulateSaleImpact = jest.fn();

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				PortfolioErrorRadarService,
				PortfolioIntelligenceService,
				{
					provide: TaxEngineService,
					useValue: { simulateSaleImpact },
				},
			],
		}).compile();

		service = module.get<PortfolioErrorRadarService>(
			PortfolioErrorRadarService
		);
	});

	describe('detectForUser (Insights IA)', () => {
		it('traz evidência com a política, a venda e o IR do motor fiscal', () => {
			simulateSaleImpact.mockReturnValue({
				estimatedTax: 120,
				classification: 'tributavel',
			});
			// PETR4 em 12% da carteira: abaixo do limiar do motor (20%), acima da
			// política (8%).
			const positions = [
				position({ symbol: 'PETR4', totalValue: 12000, sector: 'Petroleo' }),
				...[
					'ITUB4',
					'BBAS3',
					'VALE3',
					'WEGE3',
					'ABEV3',
					'RENT3',
					'SUZB3',
					'EGIE3',
					'RADL3',
					'TOTS3',
				].map((symbol, i) =>
					position({ symbol, totalValue: 8800, sector: `Setor${i}` })
				),
			];

			const result = service.detectForUser(positions, {
				policy: {
					maxAssetWeightPct: 8,
					maxSectorWeightPct: 25,
					fixedIncomeTargetPct: 25,
					brStocksTargetPct: 28,
					maxCryptoPct: 5,
					benchmark: 'IBOV_CDI',
				},
				holdings: [
					{
						symbol: 'PETR4',
						assetType: 'stock',
						quantity: 400,
						price: 30,
						totalCost: 400 * 25,
					},
				],
				pricesAsOf: '2026-10-08T21:00:00.000Z',
				now: new Date('2026-10-09T12:00:00Z'),
			});

			const petr4 = result.alerts.find((a) => a.code === 'POLICY_ASSET_LIMIT');
			expect(petr4?.message).toBe(
				'PETR4 está em 12% da carteira, acima do limite de 8% da sua política.'
			);
			expect(petr4?.evidence?.basis).toBe(
				'Valor de mercado de 11 posição(ões), com cotações até 08/10/2026.'
			);
			expect(petr4?.action).toMatchObject({
				symbol: 'PETR4',
				estimatedTax: 120,
				taxClassification: 'tributavel',
			});
			expect(simulateSaleImpact).toHaveBeenCalledWith(
				expect.objectContaining({
					symbol: 'PETR4',
					sellPrice: 30,
					currentPosition: { quantity: 400, totalCost: 10000 },
				})
			);
			expect(result.pricesAsOf).toBe('2026-10-08T21:00:00.000Z');
		});

		it('não quebra o radar quando o motor fiscal falha', () => {
			simulateSaleImpact.mockImplementation(() => {
				throw new Error('fiscal');
			});
			const result = service.detectForUser(
				[
					position({ symbol: 'PETR4', totalValue: 9000 }),
					position({ symbol: 'ITUB4', sector: 'Bancos', totalValue: 1000 }),
				],
				{
					policy: {
						maxAssetWeightPct: 8,
						maxSectorWeightPct: 25,
						fixedIncomeTargetPct: 25,
						brStocksTargetPct: 28,
						maxCryptoPct: 5,
						benchmark: 'IBOV_CDI',
					},
					holdings: [
						{
							symbol: 'PETR4',
							assetType: 'stock',
							quantity: 300,
							price: 30,
							totalCost: 6000,
						},
					],
					pricesAsOf: null,
				}
			);

			const alert = result.alerts.find((a) => a.symbol === 'PETR4');
			expect(alert?.action?.estimatedTax).toBeNull();
			expect(alert?.action?.assumptions).toEqual([
				'O motor fiscal não conseguiu estimar o IR desta venda agora.',
			]);
			expect(alert?.evidence?.basis).toContain('última cotação gravada');
		});
	});

	describe('carteira sem posicao', () => {
		it('devolve status insufficient_data e nenhum alerta', () => {
			const result = service.detect([]);

			expect(result.status).toBe('insufficient_data');
			expect(result.riskLevel).toBeNull();
			expect(result.alerts).toEqual([]);
			expect(result.positionsCount).toBe(0);
		});

		it('trata null/undefined como carteira vazia', () => {
			expect(service.detect(null as any).status).toBe('insufficient_data');
			expect(service.detect(undefined as any).status).toBe('insufficient_data');
		});
	});

	describe('concentracao de ativo', () => {
		it('emite alerta com symbol e percentual reais quando um ativo domina a carteira', () => {
			const result = service.detect([
				position({ symbol: 'PETR4', totalValue: 9000 }),
				position({ symbol: 'ITUB4', sector: 'Bancos', totalValue: 1000 }),
			]);

			const alert = result.alerts.find(
				(item) => item.code === 'ASSET_CONCENTRATION_HIGH'
			);
			expect(alert).toBeDefined();
			expect(alert!.symbol).toBe('PETR4');
			expect(alert!.type).toBe('concentration');
			expect(alert!.severity).toBe('high');
			expect(alert!.message).toContain('PETR4');
			expect(alert!.message).toContain('90%');
		});

		it('nao emite alerta de ativo quando a carteira e bem distribuida', () => {
			// 6 ativos a ~16.7% cada, abaixo do limiar mediumAssetConcentrationPct
			// (20%) — 5 a 20% cravado bateria o limiar por >=.
			const result = service.detect([
				position({ symbol: 'PETR4', sector: 'Petroleo', totalValue: 1000 }),
				position({ symbol: 'ITUB4', sector: 'Bancos', totalValue: 1000 }),
				position({ symbol: 'VALE3', sector: 'Mineracao', totalValue: 1000 }),
				position({
					symbol: 'WEGE3',
					sector: 'Bens Industriais',
					totalValue: 1000,
				}),
				position({ symbol: 'MGLU3', sector: 'Varejo', totalValue: 1000 }),
				position({ symbol: 'HGLG11', sector: 'FII', totalValue: 1000 }),
			]);

			expect(
				result.alerts.some((item) =>
					item.code.startsWith('ASSET_CONCENTRATION')
				)
			).toBe(false);
		});
	});

	describe('demais alertas nao carregam symbol', () => {
		it('alerta de diversificacao/setor nao tem campo symbol', () => {
			const result = service.detect([
				position({ symbol: 'PETR4', sector: 'Petroleo', totalValue: 9000 }),
				position({ symbol: 'PRIO3', sector: 'Petroleo', totalValue: 1000 }),
			]);

			const sectorAlert = result.alerts.find((item) =>
				item.code.startsWith('SECTOR_CONCENTRATION')
			);
			expect(sectorAlert).toBeDefined();
			expect(sectorAlert!.symbol).toBeUndefined();
			// PortfolioIntelligenceEngine normaliza a chave de setor pra
			// maiusculas (comportamento existente, não deste serviço).
			expect(sectorAlert!.message).toContain('PETROLEO');
		});
	});

	describe('correlacao', () => {
		it('nunca emite alerta do tipo correlacao — sem dado historico pra sustentar', () => {
			const result = service.detect([
				position({ symbol: 'PETR4' }),
				position({ symbol: 'ITUB4', sector: 'Bancos' }),
			]);

			expect(result.alerts.every((item) => item.code !== 'CORRELATION')).toBe(
				true
			);
			expect(
				(result.alerts as any[]).every((item) => item.type !== 'correlation')
			).toBe(true);
		});
	});

	describe('repasse de riskLevel', () => {
		it('propaga o riskLevel do PortfolioIntelligenceEngine', () => {
			const result = service.detect([
				position({ symbol: 'PETR4', totalValue: 9000 }),
				position({ symbol: 'ITUB4', sector: 'Bancos', totalValue: 1000 }),
			]);

			expect(['low', 'medium', 'high']).toContain(result.riskLevel);
			expect(result.modelVersion).toBe('portfolio_error_radar_v1');
		});
	});

	describe('determinismo', () => {
		it('mesma entrada produz exatamente a mesma saida', () => {
			const positions = [
				position({ symbol: 'PETR4', totalValue: 9000 }),
				position({ symbol: 'ITUB4', sector: 'Bancos', totalValue: 1000 }),
			];

			expect(service.detect(positions)).toEqual(service.detect(positions));
		});
	});
});
