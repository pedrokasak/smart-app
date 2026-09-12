import { Injectable } from '@nestjs/common';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';
import {
	PortfolioScoreOutput,
	PortfolioScoreDimension,
} from 'src/intelligence/application/portfolio-score.types';

/**
 * Score de carteira (0-100) a partir das estimativas deterministicas que o
 * PortfolioIntelligenceEngine ja calcula.
 *
 * Substitui o `investment_score` que vinha do LLM no trackerr-ia. Aquele
 * declarava quatro dimensoes (diversification, risk, consistency, volatility);
 * so as duas primeiras tem equivalente calculavel hoje. Consistencia e
 * volatilidade de carteira ficaram de fora deliberadamente: inventar formula
 * para preencher a UI produziria o mesmo tipo de numero fabricado que a
 * migracao existe para eliminar (TRA-5).
 */
@Injectable()
export class PortfolioScoreService {
	private static readonly WEIGHTS = {
		diversification: 0.5,
		risk: 0.5,
	} as const;

	constructor(
		private readonly portfolioIntelligenceService: PortfolioIntelligenceService
	) {}

	compute(positions: PortfolioIntelligencePosition[]): PortfolioScoreOutput {
		const safePositions = positions || [];

		if (safePositions.length === 0) {
			return {
				modelVersion: 'portfolio_score_v1',
				overall: null,
				status: 'insufficient_data',
				dimensions: [],
				diversificationStatus: null,
				riskLevel: null,
				flags: [],
				positionsCount: 0,
			};
		}

		const analysis =
			this.portfolioIntelligenceService.analyzePositions(safePositions);
		const { diversification, risk } = analysis.estimates;

		// O engine devolve risco na direcao "maior = mais arriscado". O score
		// de carteira e "maior = melhor", entao entra invertido.
		const riskAsQuality = this.clamp(100 - risk.score);

		const dimensions: PortfolioScoreDimension[] = [
			{
				key: 'diversification',
				score: this.clamp(diversification.score),
				weight: PortfolioScoreService.WEIGHTS.diversification,
			},
			{
				key: 'risk',
				score: riskAsQuality,
				weight: PortfolioScoreService.WEIGHTS.risk,
			},
		];

		const overall = this.clamp(
			dimensions.reduce(
				(sum, dimension) => sum + dimension.score * dimension.weight,
				0
			)
		);

		return {
			modelVersion: 'portfolio_score_v1',
			overall,
			status: 'ok',
			dimensions,
			diversificationStatus: diversification.status,
			riskLevel: risk.level,
			flags: risk.flags,
			positionsCount: safePositions.length,
		};
	}

	private clamp(score: number): number {
		if (!Number.isFinite(score)) return 0;
		return Math.max(0, Math.min(100, Number(score.toFixed(2))));
	}
}
