import { Injectable } from '@nestjs/common';
import { TaxEngineService } from 'src/fiscal/tax-engine/application/tax-engine.service';
import { FutureSimulatorService } from 'src/intelligence/application/future-simulator.service';
import { OpportunityRadarService } from 'src/intelligence/application/opportunity-radar.service';
import {
	PremiumInsightCategory,
	PremiumInsightItem,
	PremiumInsightsInput,
	PremiumInsightsOutput,
} from 'src/intelligence/application/unified-intelligence.types';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';

@Injectable()
export class PremiumInsightsService {
	constructor(
		private readonly portfolioIntelligenceService: PortfolioIntelligenceService,
		private readonly taxEngineService: TaxEngineService,
		private readonly opportunityRadarService: OpportunityRadarService,
		private readonly futureSimulatorService: FutureSimulatorService
	) {}

	async generate(input: PremiumInsightsInput): Promise<PremiumInsightsOutput> {
		const warnings: string[] = [];
		const insights: PremiumInsightItem[] = [];

		const portfolioAnalysis =
			this.portfolioIntelligenceService.analyzePositions(input.positions);
		const portfolioRisk = portfolioAnalysis.estimates.risk;
		const topAsset = portfolioAnalysis.facts.concentrationByAsset[0];
		const topSector = portfolioAnalysis.facts.concentrationBySector.find(
			(item) => item.key !== 'UNKNOWN'
		);

		if (portfolioRisk.level === 'high' || topAsset?.severity === 'high') {
			insights.push({
				id: `risk:portfolio:${topAsset?.key || 'global'}`,
				priority: 'critical',
				category: 'risk',
				title: 'Concentracao de risco elevada na carteira',
				justification: [
					`Risco agregado em ${portfolioRisk.level} (${portfolioRisk.score})`,
					topAsset
						? `Ativo mais concentrado: ${topAsset.key} (${Number(topAsset.percentage.toFixed(2))}%)`
						: 'Sem ativo dominante identificado',
				],
				suggestedAction:
					'Revisar limites de concentracao e considerar rebalanceamento para reduzir risco especifico.',
				relatedSymbols: topAsset?.key ? [topAsset.key] : [],
				origin: 'portfolio',
				score: 95,
			});
		} else if (topSector?.severity === 'high') {
			insights.push({
				id: `rebalance:sector:${topSector.key}`,
				priority: 'high',
				category: 'rebalance',
				title: `Exposicao setorial elevada em ${topSector.key}`,
				justification: [
					`Setor com concentracao alta: ${Number(topSector.percentage.toFixed(2))}%`,
				],
				suggestedAction:
					'Comparar novas entradas em setores subalocados antes de aumentar a posicao atual.',
				relatedSymbols: [],
				origin: 'portfolio',
				score: 82,
			});
		}

		const opportunity = await this.opportunityRadarService.detect({
			portfolioPositions: input.positions,
			candidateSymbols: input.opportunityInput?.candidateSymbols,
			watchlistSymbols: input.opportunityInput?.watchlistSymbols,
			sectorTargetAllocation: input.opportunityInput?.sectorTargetAllocation,
			rules: input.opportunityInput?.rules,
			fiscalContext: {
				hasCompensableLoss: input.fiscalInput?.hasCompensableLoss,
			},
		});
		warnings.push(...opportunity.warnings);
		const bestSignal = opportunity.signals[0];
		if (bestSignal) {
			insights.push({
				id: `opportunity:${bestSignal.id}`,
				priority: this.mapOpportunityPriority(bestSignal.priority),
				category: bestSignal.kind === 'rebalance' ? 'rebalance' : 'opportunity',
				title: bestSignal.title,
				justification: bestSignal.details.slice(0, 3),
				suggestedAction:
					bestSignal.kind === 'opportunity'
						? 'Avaliar entrada gradual conforme plano de risco e alocacao.'
						: 'Revisar estrategia de rebalanceamento com base nos gaps identificados.',
				relatedSymbols: bestSignal.symbol ? [bestSignal.symbol] : [],
				origin: 'opportunity_radar',
				score: bestSignal.score,
			});
		}

		if (input.fiscalInput?.sellSimulation) {
			const fiscal = this.taxEngineService.simulateSaleImpact(
				input.fiscalInput.sellSimulation
			);
			if (fiscal.estimatedTax > 0 || fiscal.compensationUsed > 0) {
				insights.push({
					id: `fiscal:sell:${fiscal.symbol}`,
					priority: fiscal.compensationUsed > 0 ? 'high' : 'medium',
					category: 'fiscal',
					title:
						fiscal.compensationUsed > 0
							? 'Simulacao fiscal com compensacao de prejuizo'
							: 'Impacto fiscal relevante em simulacao de venda',
					justification: [
						`Imposto estimado: ${fiscal.estimatedTax}`,
						`Classificacao: ${fiscal.classification}`,
						`Compensacao utilizada: ${fiscal.compensationUsed}`,
					],
					suggestedAction:
						fiscal.compensationUsed > 0
							? 'Revisar janela de venda para aproveitar compensacao sem elevar risco.'
							: 'Comparar cenarios de venda parcial e total antes da execucao.',
					relatedSymbols: [fiscal.symbol],
					origin: 'tax_engine',
					score: fiscal.compensationUsed > 0 ? 76 : 65,
				});
			}
		} else if (input.fiscalInput?.hasCompensableLoss) {
			insights.push({
				id: 'fiscal:compensable_loss',
				priority: 'medium',
				category: 'fiscal',
				title: 'Prejuizo compensavel disponivel',
				justification: ['Existe base fiscal para compensacao em lucro futuro.'],
				suggestedAction:
					'Incluir criterio fiscal nas proximas simulacoes de venda.',
				relatedSymbols: [],
				origin: 'tax_engine',
				score: 58,
			});
		}

		if (input.futureInput) {
			const future = this.futureSimulatorService.simulate({
				positions: input.positions,
				horizon: input.futureInput.horizon,
				monthlyContribution: input.futureInput.monthlyContribution,
			});
			const baseDelta = Number(
				(
					future.scenarios.base.projectedValue - future.currentPortfolioValue
				).toFixed(2)
			);
			insights.push({
				id: `future:${input.futureInput.horizon}`,
				priority: baseDelta >= 0 ? 'medium' : 'high',
				category: 'future',
				title: 'Cenario futuro estimado para a carteira',
				justification: [
					`Horizonte: ${future.horizon}`,
					`Delta no cenario base: ${baseDelta}`,
					`Dividendo anual estimado no cenario base: ${future.dividendProjection.scenarios.base.annual}`,
				],
				suggestedAction:
					'Usar o cenario base como referencia e validar sensibilidade com aportes e risco alvo.',
				relatedSymbols: [],
				origin: 'future_simulator',
				score: 55,
			});
		}

		const conflictAdjusted = this.resolveConflicts(insights);
		const ranked = conflictAdjusted.sort((a, b) => b.score - a.score);
		const limited = ranked.slice(0, input.plan === 'global_investor' ? 8 : 5);

		return {
			modelVersion: 'premium_insights_v1',
			plan: input.plan,
			insights: limited,
			signals: this.countByCategory(limited),
			warnings: Array.from(new Set(warnings)),
		};
	}

	private resolveConflicts(
		insights: PremiumInsightItem[]
	): PremiumInsightItem[] {
		const riskSymbols = new Set(
			insights
				.filter((item) => item.category === 'risk')
				.flatMap((item) => item.relatedSymbols || [])
		);
		return insights.map((item) => {
			if (item.category !== 'opportunity') return item;
			const hasConflict = item.relatedSymbols.some((symbol) =>
				riskSymbols.has(symbol)
			);
			if (!hasConflict) return item;
			return {
				...item,
				score: Math.max(item.score - 20, 0),
				justification: Array.from(
					new Set([
						...item.justification,
						'Conflito com sinal de risco para o mesmo ativo.',
					])
				),
			};
		});
	}

	private countByCategory(
		insights: PremiumInsightItem[]
	): PremiumInsightsOutput['signals'] {
		const count = (category: PremiumInsightCategory) =>
			insights.filter((item) => item.category === category).length;
		return {
			risk: count('risk'),
			opportunity: count('opportunity'),
			fiscal: count('fiscal'),
			future: count('future'),
			rebalance: count('rebalance'),
		};
	}

	private mapOpportunityPriority(
		priority: 'critical' | 'high' | 'medium' | 'low'
	): PremiumInsightItem['priority'] {
		if (priority === 'critical' || priority === 'high') return 'high';
		if (priority === 'medium') return 'medium';
		return 'low';
	}
}
