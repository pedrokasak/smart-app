import { Injectable } from '@nestjs/common';
import { TrackerrScoreService } from 'src/intelligence/application/trackerr-score.service';
import { AssetOpinionOutput } from 'src/intelligence/application/asset-opinion.types';
import { TrackerrScorePillar } from 'src/intelligence/application/trackerr-score.types';

const PILLAR_LABEL: Record<TrackerrScorePillar, string> = {
	qualidade: 'qualidade',
	risco: 'risco controlado',
	valuation: 'valuation',
	fiscal: 'eficiência fiscal',
	portfolio_fit: 'encaixe na carteira',
};

/**
 * Compoe o Trackerr Score (por ativo, ja determinístico) num resumo
 * estruturado para a tela de detalhe do ativo. Substitui o que
 * `web/src/services/ai/assetOpinion.ts` fazia sozinho no cliente: um
 * benchmark com limiares fixos que emitia COMPRA/HOLD/VENDA (TRA-53) e uma
 * chamada de chat generico sem validacao contra fato nenhum.
 *
 * Sem chamada a LLM. `TrackerrScoreOutput.explanation` ja fornece drivers
 * textuais deterministicos (reasonCodes com direcao up/down); este servico
 * so escolhe e formata, nao inventa. Narrativa por modelo fica para quando
 * houver validador (mesmo padrao desenhado para o digest de e-mail, TRA-17).
 */
@Injectable()
export class AssetOpinionService {
	constructor(private readonly trackerrScoreService: TrackerrScoreService) {}

	async getOpinion(
		userId: string,
		symbol: string
	): Promise<AssetOpinionOutput> {
		const score = await this.trackerrScoreService.getScoreForUser(
			userId,
			symbol
		);

		const qualityText =
			score.overallScore >= 80
				? 'qualidade elevada'
				: score.overallScore >= 60
					? 'qualidade sólida'
					: score.overallScore >= 40
						? 'qualidade mista'
						: 'qualidade fraca';

		const summary = `${score.symbol} apresenta ${qualityText} no padrão Trackerr (score ${score.overallScore}/100).`;

		const strength =
			score.explanation.topPositiveDrivers[0] ||
			(score.status === 'degraded'
				? `Dados de mercado limitados para ${score.symbol} no momento.`
				: `${score.symbol} mantém sinais mistos, mas com pontos objetivos para monitoramento.`);

		const attention =
			score.explanation.topNegativeDrivers[0] ||
			(score.status === 'degraded'
				? 'Parte dos indicadores não está disponível; a leitura pode mudar quando os dados completarem.'
				: 'Acompanhe execução e contexto macroeconômico para validar a tese.');

		const topPillars = [...score.pillars]
			.sort((a, b) => b.weightedScore - a.weightedScore)
			.slice(0, 2)
			.map((pillar) => PILLAR_LABEL[pillar.pillar]);

		const tags = [`score_${score.overallScore}`, ...topPillars].slice(0, 3);

		return {
			symbol: score.symbol,
			summary,
			strength,
			attention,
			tags,
			scoreOverall: score.overallScore,
			status: score.status,
		};
	}
}
