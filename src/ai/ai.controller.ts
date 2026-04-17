import {
	Controller,
	Post,
	Body,
	UseGuards,
	Request,
	HttpCode,
	HttpStatus,
	Logger,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import {
	ApiBearerAuth,
	ApiOkResponse,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';
import { AiAnalysisResponseDto } from './dto/ai-analysis-response.dto';
import { AiAnalysisRequestDto } from './dto/ai-analysis-request.dto';
import { IntelligentChatRequestDto } from './intelligence/dto/intelligent-chat-request.dto';
import { ChatOrchestratorService } from './orchestration/chat-orchestrator.service';
import { ChatOrchestratorResponse } from './orchestration/chat-orchestrator.types';
import { TrackerrScoreService } from 'src/intelligence/application/trackerr-score.service';

@Controller('ai')
@ApiTags('ai')
@ApiBearerAuth('access-token')
export class AiController {
	private readonly logger = new Logger(AiController.name);

	constructor(
		private readonly aiService: AiService,
		private readonly chatOrchestratorService: ChatOrchestratorService,
		private readonly trackerrScoreService: TrackerrScoreService
	) {}

	/**
	 * POST /ai/analyze
	 * Recebe dados do portfólio e perfil do usuário (já com métricas dos ativos)
	 * e repassa para o trakker-ia para análise híbrida (Prophet + LLM).
	 */
	@Post('analyze')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	@ApiOkResponse({ type: AiAnalysisResponseDto, description: 'Análise de IA' })
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	@ApiResponse({ status: 500, description: 'Trakker-IA indisponível.' })
	async analyze(
		@Request() req: any,
		@Body() body: AiAnalysisRequestDto & Record<string, any>
	): Promise<AiAnalysisResponseDto> {
		const userId = req.user?.userId || req.user?.sub;

		// Monta o payload completo para o trakker-ia
		// O frontend pode enviar o portfólio já formatado; completamos com o userId
		const payload = {
			...body,
			user_id: body.user_id || userId,
		};

		return this.aiService.analyzePortfolio(payload);
	}

	@Post('simulate')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	async simulate(@Body() body: any): Promise<any> {
		return this.aiService.simulate(body);
	}

	@Post('chat')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	async chat(@Body() body: any): Promise<any> {
		return this.aiService.chat(body);
	}

	@Post('chat/intelligent')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	async intelligentChat(
		@Request() req: any,
		@Body() body: IntelligentChatRequestDto
	): Promise<any> {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		try {
			const orchestration = await this.chatOrchestratorService.orchestrate(
				userId,
				body?.question || '',
				{
					investorProfile: body?.investorProfile,
					copilotFlow: body?.copilotFlow,
					decisionFlow: body?.decisionFlow,
				}
			);
			return {
				intent: orchestration.intent,
				deterministic: orchestration.deterministic,
				route: orchestration.route,
				message: this.buildIntelligentMessage(orchestration),
				data: orchestration.data,
				unavailable: orchestration.unavailable,
				warnings: orchestration.warnings,
				assumptions: orchestration.assumptions,
			};
		} catch (error: any) {
			this.logger.error(
				`intelligentChat orchestration failed: ${error?.message || 'unknown_error'}`
			);
			return {
				intent: 'unknown',
				deterministic: false,
				route: {
					type: 'synthesis_required',
					llmEligible: true,
					reason: 'insufficient_structured_data',
				},
				message:
					'Não consegui consolidar todos os dados agora, mas posso continuar te ajudando. Tente reformular a pergunta ou repetir em instantes.',
				data: {},
				unavailable: [],
				warnings: ['chat_orchestration_failed'],
				assumptions: [],
			};
		}
	}

	@Post('trackerr-score')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	async trackerrScore(
		@Request() req: any,
		@Body()
		body: {
			symbol: string;
			previousPillarScores?: Record<string, number>;
		}
	) {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		return this.trackerrScoreService.getScoreForUser(userId, body?.symbol, {
			previousPillarScores: body?.previousPillarScores as any,
		});
	}

	private buildIntelligentMessage(response: ChatOrchestratorResponse): string {
		const data = response.data || {};

		// If there is a critical warning, use it to form a coherent response.
		if (response.warnings && response.warnings.length > 0) {
			const primaryWarning = response.warnings[0];
			if (primaryWarning === 'sell_simulation_requires_owned_asset') {
				const symbol = response.unavailable?.[0] || 'o ativo';
				return `Você não possui ${symbol} na carteira no momento. Só conseguimos simular imposto e lucro para ativos que você já comprou.`;
			}
			if (primaryWarning === 'tax_estimation_requires_owned_asset') {
				return 'Você precisa ter o ativo na carteira para estimarmos o cálculo de imposto.';
			}
			if (primaryWarning === 'comparison_requires_two_assets') {
				return 'Para um comparativo, por favor informe pelo menos dois ativos diferentes (Ex: "PETR4 vs VALE3").';
			}
			if (primaryWarning === 'missing_sell_price_for_simulation') {
				return 'Não consegui obter o preço atual do ativo no mercado para calcular a simulação.';
			}
		}

		switch (response.intent) {
			case 'portfolio_risk': {
				const riskScore = (data as any)?.portfolioRisk?.risk?.score;
				const topAsset = (data as any)?.portfolioRisk?.concentrationByAsset?.[0];
				const topConcentrationPct = this.resolveConcentrationPct(topAsset);
				const rebalanceSuggestion = (data as any)?.rebalanceSuggestion;

				let msg = 'Avaliei a exposição e as concentrações do seu portfólio.';
				if (typeof riskScore === 'number') {
					msg = `Sua carteira apresenta um Score de Risco de ${riskScore.toFixed(0)}/100.`;
				}
				if (topAsset && topConcentrationPct > 0) {
					msg += ` A maior concentração identificada é em ${topAsset.symbol || topAsset.key} (${topConcentrationPct.toFixed(1)}%).`;
				}
				if (rebalanceSuggestion?.riskScore?.targetReductionPct) {
					msg += ` Sugestão estimada por perfil (${rebalanceSuggestion.profile || 'conservador'}): reduzir risco em ${Number(rebalanceSuggestion.riskScore.targetReductionPct).toFixed(0)}% para alvo de score ${Number(rebalanceSuggestion.riskScore.targetSuggested || 0).toFixed(1)}.`;
				}
				if (Array.isArray(rebalanceSuggestion?.targetAllocationMix) && rebalanceSuggestion.targetAllocationMix.length > 0) {
					const mixLabel = rebalanceSuggestion.targetAllocationMix
						.slice(0, 4)
						.map((item: any) => `${item.bucket}: ${Number(item.targetPct || 0).toFixed(0)}%`)
						.join(' · ');
					msg += ` Mix sugerido para balanceamento: ${mixLabel}.`;
				}
				return msg;
			}
			case 'investment_committee': {
				const committee = (data as any)?.investmentCommittee || {};
				const recommended = Array.isArray(committee.recommended)
					? committee.recommended
					: Array.isArray(committee.recommendedAssets)
						? committee.recommendedAssets
						: [];
				const avoid = Array.isArray(committee.avoid)
					? committee.avoid
					: Array.isArray(committee.avoidAssets)
						? committee.avoidAssets
						: [];
				const risks = Array.isArray(committee.criticalRisks)
					? committee.criticalRisks
					: [];
				const plan = Array.isArray(committee.objectivePlan)
					? committee.objectivePlan
					: [];
				const topRecommended = recommended[0];
				const topAvoid = avoid[0];
				const topRecommendedSymbol =
					typeof topRecommended === 'string'
						? topRecommended
						: topRecommended?.symbol || null;
				const topAvoidSymbol =
					typeof topAvoid === 'string'
						? topAvoid
						: topAvoid?.symbol || null;
				const topRecommendedReason =
					typeof topRecommended === 'object' &&
					Array.isArray(topRecommended?.reasons) &&
					topRecommended.reasons.length > 0
						? String(topRecommended.reasons[0])
						: null;
				const topAvoidReason =
					typeof topAvoid === 'object' &&
					Array.isArray(topAvoid?.reasons) &&
					topAvoid.reasons.length > 0
						? String(topAvoid.reasons[0])
						: null;

				let msg = `Comitê semanal gerado com ${recommended.length} recomendação(ões), ${avoid.length} ativo(s) para evitar e ${risks.length} risco(s) crítico(s).`;
				if (topRecommendedSymbol && topRecommendedReason) {
					msg += ` Destaque positivo: ${topRecommendedSymbol} por ${topRecommendedReason.toLowerCase()}.`;
				}
				if (topAvoidSymbol && topAvoidReason) {
					msg += ` Atenção: ${topAvoidSymbol} porque ${topAvoidReason.toLowerCase()}.`;
				}
				if (plan.length > 0) {
					msg += ` Prioridade da semana: ${String(plan[0]).replace(/\.$/, '')}.`;
				}
				return msg;
			}
			case 'tax_estimation':
			case 'sell_simulation': {
				const tax = (data as any)?.sellSimulation?.estimatedTax;
				const pnl = (data as any)?.sellSimulation?.realizedPnl;
				
				if (typeof tax === 'number' && typeof pnl === 'number') {
					if (tax > 0) {
						return `Se você vender a posição, precisará pagar aproximadamente R$ ${tax.toFixed(2)} de imposto sobre um lucro estimado de R$ ${pnl.toFixed(2)}.`;
					} else if (pnl < 0) {
						return `A simulação indica que essa venda geraria um prejuízo de R$ ${Math.abs(pnl).toFixed(2)}, isento de imposto.`;
					}
					return `Se você vender a posição, seu lucro será de R$ ${pnl.toFixed(2)}, isento de imposto (dentro das regras vigentes).`;
				}
				return 'A simulação fiscal foi processada com sucesso no painel abaixo.';
			}
			case 'asset_comparison':
				return 'Aqui está o comparativo detalhado das métricas de fundamentos dos ativos solicitados:';
			case 'external_asset_analysis':
			case 'external_asset_question':
				return 'Encontrei os seguintes dados de mercado atualizados para a sua solicitação:';
			case 'portfolio_summary': {
				const totalValue = (data as any)?.portfolioSummary?.totalValue;
				const portfolioAssets = Array.isArray((data as any)?.portfolioAssets)
					? ((data as any).portfolioAssets as Array<any>)
					: [];
				if (this.isPortfolioAssetListQuestion(response.question)) {
					if (!portfolioAssets.length) {
						return 'Sua carteira está sem ativos no momento.';
					}
					const listed = portfolioAssets
						.slice(0, 8)
						.map((asset) => {
							const pct = Number(asset?.allocationPct || 0);
							const pctLabel = Number.isFinite(pct) ? `${pct.toFixed(1)}%` : 'N/D';
							return `${asset?.symbol || 'Ativo'} (${pctLabel})`;
						})
						.join(', ');
					return `Sua carteira possui ${portfolioAssets.length} ativo(s): ${listed}.`;
				}
				return typeof totalValue === 'number'
					? `O patrimônio total estimado atual da sua carteira é de R$ ${totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`
					: 'Resumi os saldos e a distribuição de ativos da sua carteira.';
			}
			default:
				return 'Analisei seus dados com sucesso e organizei os fatos no painel interativo abaixo.';
		}
	}

	private isPortfolioAssetListQuestion(question: string): boolean {
		const text = String(question || '').toLowerCase();
		return /\b(listar|liste|quais|mostrar|mostre|descrev\w*)\b/.test(text) &&
			/\b(ativos?|carteira|portf[oó]lio)\b/.test(text);
	}

	private resolveConcentrationPct(entry: any): number {
		const weight = Number(entry?.weightPct);
		if (Number.isFinite(weight) && weight > 0) return weight;
		const percentage = Number(entry?.percentage);
		if (Number.isFinite(percentage) && percentage > 0) return percentage;
		return 0;
	}
}
