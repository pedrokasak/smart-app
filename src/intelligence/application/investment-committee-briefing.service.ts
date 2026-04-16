import { Injectable } from '@nestjs/common';
import { UnifiedIntelligenceFacade } from 'src/intelligence/application/unified-intelligence.facade';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';

export interface InvestmentCommitteeBriefingInput {
	plan: string;
	positions: PortfolioIntelligencePosition[];
	watchlistSymbols?: string[];
}

export interface InvestmentCommitteeBriefingOutput {
	status: 'ok' | 'degraded';
	plan: string;
	risksCritical: string[];
	recommendedAssets: string[];
	avoidAssets: string[];
	weeklyObjectivePlan: string[];
	warnings: string[];
}

@Injectable()
export class InvestmentCommitteeBriefingService {
	constructor(
		private readonly unifiedIntelligenceFacade: UnifiedIntelligenceFacade
	) {}

	async generate(
		input: InvestmentCommitteeBriefingInput
	): Promise<InvestmentCommitteeBriefingOutput> {
		const warnings: string[] = [];
		const normalizedPlan = String(input.plan || 'free').toLowerCase();
		if (normalizedPlan !== 'global_investor') {
			warnings.push('committee_mode_requires_global_investor');
		}

		const risk = this.unifiedIntelligenceFacade.getPortfolioRiskAnalysis({
			positions: input.positions,
		});
		const opportunities = await this.unifiedIntelligenceFacade.detectOpportunities({
			portfolioPositions: input.positions,
			candidateSymbols: input.watchlistSymbols,
		});

		const risksCritical = risk.risk.flags
			.filter((flag) => flag.severity !== 'low')
			.slice(0, 3)
			.map((flag) => flag.message);

		const recommendedAssets = Array.from(
			new Set(
				opportunities.opportunities
					.map((item) => item.symbol)
					.filter(Boolean)
			)
		).slice(0, 3);

		const avoidAssets = risk.concentrationByAsset
			.filter((item) => item.severity !== 'low')
			.map((item) => item.key)
			.slice(0, 3);

		if (recommendedAssets.length < 3) {
			warnings.push('committee_recommendations_partial');
		}
		if (avoidAssets.length < 3) {
			warnings.push('committee_avoid_list_partial');
		}

		const weeklyObjectivePlan = [
			'Reduzir concentração dos ativos com maior risco específico.',
			'Executar 1 rebalanceamento tático com validação fiscal pré-trade.',
			'Revisar oportunidades com melhor fit antes de novas compras.',
		];

		return {
			status: warnings.length ? 'degraded' : 'ok',
			plan: normalizedPlan,
			risksCritical,
			recommendedAssets,
			avoidAssets,
			weeklyObjectivePlan,
			warnings: Array.from(new Set([...warnings, ...opportunities.warnings])),
		};
	}
}
