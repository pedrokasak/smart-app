import { Test, TestingModule } from '@nestjs/testing';
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

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [PortfolioErrorRadarService, PortfolioIntelligenceService],
		}).compile();

		service = module.get<PortfolioErrorRadarService>(
			PortfolioErrorRadarService
		);
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
			expect(alert!.message).toContain('90.0%');
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
