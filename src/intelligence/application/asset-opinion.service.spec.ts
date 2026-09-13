import { Test, TestingModule } from '@nestjs/testing';
import { AssetOpinionService } from './asset-opinion.service';
import { TrackerrScoreService } from './trackerr-score.service';
import { TrackerrScoreOutput } from './trackerr-score.types';

function scoreOutput(
	overrides: Partial<TrackerrScoreOutput> = {}
): TrackerrScoreOutput {
	return {
		symbol: 'PETR4',
		assetType: 'stock',
		status: 'ok',
		overall: 72,
		overallScore: 72,
		weights: {
			qualidade: 0.25,
			risco: 0.2,
			valuation: 0.2,
			fiscal: 0.15,
			portfolio_fit: 0.2,
		},
		pillars: [
			{
				pillar: 'qualidade',
				weight: 0.25,
				score: 90,
				weightedScore: 22.5,
				reasonCodes: [],
			},
			{
				pillar: 'risco',
				weight: 0.2,
				score: 40,
				weightedScore: 8,
				reasonCodes: [],
			},
			{
				pillar: 'valuation',
				weight: 0.2,
				score: 70,
				weightedScore: 14,
				reasonCodes: [],
			},
			{
				pillar: 'fiscal',
				weight: 0.15,
				score: 60,
				weightedScore: 9,
				reasonCodes: [],
			},
			{
				pillar: 'portfolio_fit',
				weight: 0.2,
				score: 50,
				weightedScore: 10,
				reasonCodes: [],
			},
		],
		reasonCodes: { upward: [], downward: [] },
		warnings: [],
		explanation: {
			summary: 'Trackerr Score calculado com pilares fixos. Resultado: 72/100.',
			topPositiveDrivers: ['ROE acima de 15%'],
			topNegativeDrivers: ['Concentração acima do limite'],
		},
		...overrides,
	};
}

describe('AssetOpinionService', () => {
	let service: AssetOpinionService;
	const mockTrackerrScoreService = { getScoreForUser: jest.fn() };

	beforeEach(async () => {
		jest.clearAllMocks();
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AssetOpinionService,
				{
					provide: TrackerrScoreService,
					useValue: mockTrackerrScoreService,
				},
			],
		}).compile();

		service = module.get<AssetOpinionService>(AssetOpinionService);
	});

	it('usa os drivers reais do score como strength/attention, sem inventar texto', async () => {
		mockTrackerrScoreService.getScoreForUser.mockResolvedValue(scoreOutput());

		const result = await service.getOpinion('user-1', 'PETR4');

		expect(result.strength).toBe('ROE acima de 15%');
		expect(result.attention).toBe('Concentração acima do limite');
		expect(result.scoreOverall).toBe(72);
	});

	it('nunca emite verbo de recomendação (COMPRA/HOLD/VENDA)', async () => {
		mockTrackerrScoreService.getScoreForUser.mockResolvedValue(scoreOutput());

		const result = await service.getOpinion('user-1', 'PETR4');
		const fullText = `${result.summary} ${result.strength} ${result.attention} ${result.tags.join(' ')}`;

		expect(fullText).not.toMatch(/compra|venda|hold|recomend/i);
	});

	it('cai em texto de fallback quando não há reasonCode de direção', async () => {
		mockTrackerrScoreService.getScoreForUser.mockResolvedValue(
			scoreOutput({
				explanation: {
					summary: 'x',
					topPositiveDrivers: [],
					topNegativeDrivers: [],
				},
			})
		);

		const result = await service.getOpinion('user-1', 'PETR4');

		expect(result.strength).toContain('PETR4');
		expect(result.attention).toContain('macroeconômico');
	});

	it('sinaliza dado limitado no fallback quando status é degraded', async () => {
		mockTrackerrScoreService.getScoreForUser.mockResolvedValue(
			scoreOutput({
				status: 'degraded',
				explanation: {
					summary: 'x',
					topPositiveDrivers: [],
					topNegativeDrivers: [],
				},
			})
		);

		const result = await service.getOpinion('user-1', 'PETR4');

		expect(result.strength).toContain('limitados');
		expect(result.attention).toContain('não está disponível');
	});

	it('monta as tags com score e os dois pilares de maior peso ponderado', async () => {
		mockTrackerrScoreService.getScoreForUser.mockResolvedValue(scoreOutput());

		const result = await service.getOpinion('user-1', 'PETR4');

		// qualidade (22.5) e valuation (14) sao os dois maiores weightedScore.
		expect(result.tags).toEqual(['score_72', 'qualidade', 'valuation']);
	});

	it('repassa symbol e status do score', async () => {
		mockTrackerrScoreService.getScoreForUser.mockResolvedValue(
			scoreOutput({ symbol: 'VALE3', status: 'degraded' })
		);

		const result = await service.getOpinion('user-1', 'VALE3');

		expect(result.symbol).toBe('VALE3');
		expect(result.status).toBe('degraded');
	});

	it('repassa userId e symbol para o TrackerrScoreService sem transformar', async () => {
		mockTrackerrScoreService.getScoreForUser.mockResolvedValue(scoreOutput());

		await service.getOpinion('user-42', 'petr4');

		expect(mockTrackerrScoreService.getScoreForUser).toHaveBeenCalledWith(
			'user-42',
			'petr4'
		);
	});
});
