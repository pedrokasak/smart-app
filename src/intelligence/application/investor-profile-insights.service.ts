import { Injectable } from '@nestjs/common';
import { TrackerrScoreOutput } from 'src/intelligence/application/trackerr-score.types';
import {
	UnifiedPortfolioRiskOutput,
	UnifiedPortfolioSummaryOutput,
} from 'src/intelligence/application/unified-intelligence.types';

export type InvestorProfile =
	| 'renda'
	| 'crescimento'
	| 'conservador'
	| 'agressivo';

export interface InvestorProfileInsightsInput {
	profile: InvestorProfile;
	portfolioSummary: UnifiedPortfolioSummaryOutput;
	portfolioRisk: UnifiedPortfolioRiskOutput;
	trackerrScore?: TrackerrScoreOutput | null;
}

export interface InvestorProfileInsightsOutput {
	profile: InvestorProfile;
	status: 'ok' | 'degraded';
	narrative: string;
	recommendations: string[];
	warnings: string[];
}

@Injectable()
export class InvestorProfileInsightsService {
	generate(input: InvestorProfileInsightsInput): InvestorProfileInsightsOutput {
		const warnings: string[] = [];
		const totalValue = Number(input.portfolioSummary?.totalValue || 0);
		const riskScore = Number(input.portfolioRisk?.risk?.score || 0);
		const dividendAnnual = Number(
			input.portfolioSummary?.dividendProjection?.projectedAnnualIncome || 0
		);
		const score = input.trackerrScore?.overallScore ?? null;

		if (!input.trackerrScore) {
			warnings.push('profile_insight_trackerr_score_unavailable');
		}

		if (input.profile === 'renda') {
			return {
				profile: input.profile,
				status: warnings.length ? 'degraded' : 'ok',
				narrative: `Perfil renda: foco em fluxo previsível. Renda anual estimada da carteira: R$ ${dividendAnnual.toFixed(2)}.`,
				recommendations: [
					'Priorizar ativos com histórico de distribuição consistente.',
					'Evitar giro excessivo para reduzir atrito fiscal.',
					`Monitorar risco agregado (score atual: ${riskScore.toFixed(1)}).`,
				],
				warnings,
			};
		}

		if (input.profile === 'crescimento') {
			return {
				profile: input.profile,
				status: warnings.length ? 'degraded' : 'ok',
				narrative: `Perfil crescimento: busca expansão de capital com controle de risco. Patrimônio monitorado: R$ ${totalValue.toFixed(2)}.`,
				recommendations: [
					'Usar rebalanceamento para evitar concentração excessiva em winners.',
					'Priorizar ativos com melhora em qualidade e valuation no Trackerr Score.',
					typeof score === 'number'
						? `Trackerr Score atual do ativo analisado: ${score.toFixed(1)}.`
						: 'Trackerr Score indisponível para o ativo solicitado.',
				],
				warnings,
			};
		}

		if (input.profile === 'conservador') {
			return {
				profile: input.profile,
				status: warnings.length ? 'degraded' : 'ok',
				narrative: `Perfil conservador: preservação de capital com volatilidade controlada. Risco atual: ${riskScore.toFixed(1)}.`,
				recommendations: [
					'Reduzir posições com concentração acima do limite interno.',
					'Favorecer caixa/dividendos com previsibilidade.',
					'Rever cenário fiscal antes de vendas completas.',
				],
				warnings,
			};
		}

		return {
			profile: input.profile,
			status: warnings.length ? 'degraded' : 'ok',
			narrative: `Perfil agressivo: maior tolerância a risco com disciplina de execução. Risco atual: ${riskScore.toFixed(1)}.`,
			recommendations: [
				'Explorar oportunidades com upside alto, mantendo controle de drawdown.',
				'Aplicar gatilhos de redução tática quando risco exceder meta.',
				typeof score === 'number'
					? `Usar reason codes do Trackerr Score para decisões táticas (score ${score.toFixed(1)}).`
					: 'Usar dados de risco e concentração enquanto score detalhado estiver indisponível.',
			],
			warnings,
		};
	}
}
