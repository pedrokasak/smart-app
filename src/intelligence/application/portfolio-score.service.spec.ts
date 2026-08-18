import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioScoreService } from './portfolio-score.service';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';

function position(
	overrides: Partial<PortfolioIntelligencePosition> = {}
): PortfolioIntelligencePosition {
	return {
		symbol: 'PETR4',
		assetType: 'stock',
		quantity: 100,
		totalValue: 3000,
		sector: 'Petroleo',
		...overrides,
	} as PortfolioIntelligencePosition;
}

describe('PortfolioScoreService', () => {
	let service: PortfolioScoreService;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [PortfolioScoreService, PortfolioIntelligenceService],
		}).compile();

		service = module.get<PortfolioScoreService>(PortfolioScoreService);
	});

	describe('carteira sem posicao', () => {
		// O engine devolve risk.score 0 para carteira vazia, que invertido vira
		// 100 ("risco otimo"). Sem esta guarda, uma carteira vazia sairia com
		// overall 50 — numero sem significado apresentado como avaliacao.
		it('devolve overall null e status insufficient_data, nunca 0', () => {
			const result = service.compute([]);

			expect(result.status).toBe('insufficient_data');
			expect(result.overall).toBeNull();
			expect(result.overall).not.toBe(0);
			expect(result.positionsCount).toBe(0);
			expect(result.dimensions).toEqual([]);
		});

		it('trata null/undefined como carteira vazia', () => {
			expect(service.compute(null as any).status).toBe('insufficient_data');
			expect(service.compute(undefined as any).status).toBe(
				'insufficient_data'
			);
		});
	});

	describe('composicao do overall', () => {
		it('normaliza risco para "maior = melhor" antes de compor', () => {
			const concentrated = service.compute([position()]);
			const riskDimension = concentrated.dimensions.find(
				(item) => item.key === 'risk'
			);

			// Uma carteira de ativo unico e maximamente concentrada: o engine
			// marca risco alto, entao a dimensao normalizada tem que sair baixa.
			expect(concentrated.riskLevel).toBe('high');
			expect(riskDimension!.score).toBeLessThan(50);
		});

		it('overall e a media ponderada das dimensoes normalizadas', () => {
			const result = service.compute([
				position({ symbol: 'PETR4', sector: 'Petroleo', totalValue: 1000 }),
				position({ symbol: 'ITUB4', sector: 'Bancos', totalValue: 1000 }),
				position({ symbol: 'VALE3', sector: 'Mineracao', totalValue: 1000 }),
			]);

			const expected =
				result.dimensions.reduce(
					(sum, dimension) => sum + dimension.score * dimension.weight,
					0
				);

			expect(result.overall).toBeCloseTo(Number(expected.toFixed(2)), 2);
			expect(result.status).toBe('ok');
		});

		it('mantem overall dentro de 0-100', () => {
			const result = service.compute([position()]);

			expect(result.overall).toBeGreaterThanOrEqual(0);
			expect(result.overall).toBeLessThanOrEqual(100);
		});

		it('pesos das dimensoes somam 1', () => {
			const result = service.compute([position()]);
			const totalWeight = result.dimensions.reduce(
				(sum, dimension) => sum + dimension.weight,
				0
			);

			expect(totalWeight).toBeCloseTo(1, 5);
		});
	});

	describe('carteira diversificada versus concentrada', () => {
		it('pontua melhor a carteira espalhada entre setores', () => {
			const concentrated = service.compute([
				position({ symbol: 'PETR4', sector: 'Petroleo', totalValue: 9000 }),
				position({ symbol: 'PRIO3', sector: 'Petroleo', totalValue: 1000 }),
			]);

			const diversified = service.compute([
				position({ symbol: 'PETR4', sector: 'Petroleo', totalValue: 2500 }),
				position({ symbol: 'ITUB4', sector: 'Bancos', totalValue: 2500 }),
				position({ symbol: 'VALE3', sector: 'Mineracao', totalValue: 2500 }),
				position({ symbol: 'WEGE3', sector: 'Bens Industriais', totalValue: 2500 }),
			]);

			expect(diversified.overall).toBeGreaterThan(concentrated.overall!);
		});
	});

	describe('determinismo', () => {
		it('mesma entrada produz exatamente a mesma saida', () => {
			const positions = [
				position({ symbol: 'PETR4', sector: 'Petroleo' }),
				position({ symbol: 'ITUB4', sector: 'Bancos' }),
			];

			expect(service.compute(positions)).toEqual(service.compute(positions));
		});
	});

	describe('repasse de contexto', () => {
		it('propaga riskLevel, diversificationStatus e flags do engine', () => {
			const result = service.compute([position()]);

			expect(['low', 'medium', 'high']).toContain(result.riskLevel);
			expect(['poor', 'moderate', 'good', 'excellent']).toContain(
				result.diversificationStatus
			);
			expect(Array.isArray(result.flags)).toBe(true);
			expect(result.modelVersion).toBe('portfolio_score_v1');
		});
	});
});
