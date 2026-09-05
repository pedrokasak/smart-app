import {
	Controller,
	Get,
	Post,
	Put,
	Body,
	UseGuards,
	Request,
	HttpCode,
	HttpStatus,
	UnauthorizedException,
	ForbiddenException,
	Inject,
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
import { AiChatRequestDto } from 'src/ai/dto/ai-chat-request.dto';
import { InsightsRequestDto, InsightsResponseDto } from './dto/insight.dto';
import { AiSimulateRequestDto } from 'src/ai/dto/ai-simulate-request.dto';
import { AiAnalysisRequestDto } from './dto/ai-analysis-request.dto';
import { FutureSimulatorRequestDto } from './dto/future-simulator-request.dto';
import { IntelligentChatRequestDto } from './intelligence/dto/intelligent-chat-request.dto';
import { ChatOrchestratorService } from './orchestration/chat-orchestrator.service';
import { RagColdStartService } from 'src/ai/rag-ingestion/application/rag-cold-start.service';
import { ChatOrchestratorResponse } from './orchestration/chat-orchestrator.types';
import { TrackerrScoreService } from 'src/intelligence/application/trackerr-score.service';
import { AssetOpinionService } from 'src/intelligence/application/asset-opinion.service';
import { AssetOpinionOutput } from 'src/intelligence/application/asset-opinion.types';
import { AssetOpinionRequestDto } from './dto/asset-opinion-request.dto';
import { PortfolioScoreService } from 'src/intelligence/application/portfolio-score.service';
import { PortfolioErrorRadarService } from 'src/intelligence/application/portfolio-error-radar.service';
import { PortfolioErrorRadarOutput } from 'src/intelligence/application/portfolio-error-radar.types';
import { PortfolioScoreOutput } from 'src/intelligence/application/portfolio-score.types';
import { UnifiedIntelligenceFacade } from 'src/intelligence/application/unified-intelligence.facade';
import {
	FutureSimulatorOutput,
	OpportunityRadarOutput,
} from 'src/intelligence/application/unified-intelligence.types';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { InvestorProfileService } from 'src/intelligence/application/investor-profile/investor-profile.service';
import { InvestorSophisticationProfile } from 'src/intelligence/application/investor-profile/investor-profile.types';
import { InvestorProfileOverrideDto } from './dto/investor-profile-override.dto';
import { ChatHistoryService } from 'src/ai/chat-history/chat-history.service';
import { AppendChatMessageRequestDto } from 'src/ai/chat-history/dto/append-chat-message-request.dto';
import { ChatMessage } from 'src/ai/chat-history/schema/chat-message.schema';
import { OpportunityRadarRequestDto } from './dto/opportunity-radar-request.dto';
import {
	planAtLeast,
	USER_PLAN_RESOLVER,
	UserPlanResolverPort,
} from 'src/subscription/application/user-plan.types';

@Controller('ai')
@ApiTags('ai')
@ApiBearerAuth('access-token')
export class AiController {
	private readonly logger = new Logger(AiController.name);

	constructor(
		private readonly aiService: AiService,
		private readonly chatOrchestratorService: ChatOrchestratorService,
		private readonly trackerrScoreService: TrackerrScoreService,
		private readonly portfolioScoreService: PortfolioScoreService,
		private readonly portfolioErrorRadarService: PortfolioErrorRadarService,
		private readonly assetOpinionService: AssetOpinionService,
		private readonly unifiedIntelligenceFacade: UnifiedIntelligenceFacade,
		private readonly portfolioService: PortfolioService,
		private readonly ragColdStart: RagColdStartService,
		private readonly investorProfileService: InvestorProfileService,
		private readonly chatHistoryService: ChatHistoryService,
		@Inject(USER_PLAN_RESOLVER)
		private readonly userPlanResolver: UserPlanResolverPort
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
		const userId = String(req.user?.userId ?? req.user?.sub ?? '');
		if (!userId) {
			throw new UnauthorizedException('User ID ausente no token');
		}

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
	async simulate(@Body() body: AiSimulateRequestDto): Promise<any> {
		return this.aiService.simulate(body);
	}

	/**
	 * POST /ai/future-simulator
	 * Expoe FutureSimulatorService.simulate() diretamente, sem passar pela
	 * API Python legada nem pelo chat. Mesma logica de projecao (cenarios
	 * pessimista/base/otimista + dividendos) que o Chat Inteligente ja usa
	 * internamente para a intencao "future_scenario".
	 */
	@Post('future-simulator')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	async futureSimulator(
		@Request() req: any,
		@Body() body: FutureSimulatorRequestDto
	): Promise<FutureSimulatorOutput> {
		const userId = String(req.user?.userId ?? req.user?.sub ?? '');
		if (!userId) {
			throw new UnauthorizedException('User ID ausente no token');
		}

		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const assets = portfolios.flatMap((portfolio: any) =>
			Array.isArray(portfolio?.assets) ? portfolio.assets : []
		);
		const positions = this.toPositions(assets);

		return this.unifiedIntelligenceFacade.simulateFuture({
			positions,
			horizon: body.horizon,
			monthlyContribution: body.monthlyContribution,
		});
	}

	/**
	 * POST /ai/insights
	 * Espelha o novo `/api/insights` do trackerr-ia (TRA-56/133). Repassa o
	 * `user_profile` recebido e devolve o payload de insights com evidencia,
	 * confianca, acao e fontes. Nao inventa dado — o server so encaminha.
	 * O `user_id` do JWT sobrescreve qualquer `user_id` do corpo, para
	 * evitar que o cliente consulte insight de outro usuario.
	 */
	@Post('insights')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	async insights(
		@Request() req: any,
		@Body() body: InsightsRequestDto
	): Promise<InsightsResponseDto> {
		const userId = String(req.user?.userId ?? req.user?.sub ?? '');
		if (!userId) {
			throw new UnauthorizedException('User ID ausente no token');
		}
		const userProfile = {
			...(body?.user_profile || {}),
			user_id: userId,
		};
		return this.aiService.getInsights(userProfile, body?.data_freshness_days);
	}

	@Post('chat')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	async chat(@Body() body: AiChatRequestDto): Promise<any> {
		return this.aiService.chat(body);
	}

	@Post('chat/intelligent')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	async intelligentChat(
		@Request() req: any,
		@Body() body: IntelligentChatRequestDto
	): Promise<any> {
		const userId = String(req.user?.userId ?? req.user?.id ?? '');
		if (!userId) {
			throw new UnauthorizedException('User ID ausente no token');
		}
		// Cold-start (TRA-88): dispara a ingestão de RAG do usuário em
		// background. Fire-and-forget — não bloqueia a resposta. Fecha a janela
		// entre o usuário entrar e o cron diário rodar, em que o RAG dele
		// estaria vazio. Só afeta Pro+ (gate no scheduler) e é barato por hash.
		this.ragColdStart.trigger(userId);
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

	/**
	 * GET /ai/chat/history
	 * Histórico persistido do Chat Inteligente (TRA-66) do usuário
	 * autenticado, em ordem cronológica. Sem gate de plano no backend —
	 * mesmo padrão de POST /ai/chat/intelligent, o gate PRO+ é feito no
	 * frontend.
	 */
	@Get('chat/history')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	async getChatHistory(@Request() req: any): Promise<ChatMessage[]> {
		const userId = String(req.user?.userId ?? req.user?.sub ?? '');
		if (!userId) {
			throw new UnauthorizedException('User ID ausente no token');
		}
		return this.chatHistoryService.listByUser(userId);
	}

	/**
	 * POST /ai/chat/history
	 * Persiste uma mensagem (user ou assistant) do Chat Inteligente
	 * associada ao usuário autenticado.
	 */
	@Post('chat/history')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.CREATED)
	async appendChatHistory(
		@Request() req: any,
		@Body() body: AppendChatMessageRequestDto
	): Promise<ChatMessage> {
		const userId = String(req.user?.userId ?? req.user?.sub ?? '');
		if (!userId) {
			throw new UnauthorizedException('User ID ausente no token');
		}
		return this.chatHistoryService.append(userId, body);
	}

	/**
	 * GET /ai/portfolio-score
	 * Score deterministico da carteira, substituindo o `investment_score` que
	 * vinha do LLM em /api/hybrid-analysis. Nao recebe corpo: opera sobre a
	 * carteira do usuario autenticado.
	 *
	 * Nao confundir com POST /ai/trackerr-score, que pontua UM ativo.
	 */
	@Get('portfolio-score')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	async portfolioScore(@Request() req: any): Promise<PortfolioScoreOutput> {
		const userId = String(req.user?.userId ?? req.user?.sub ?? '');
		if (!userId) {
			throw new UnauthorizedException('User ID ausente no token');
		}

		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const assets = portfolios.flatMap((portfolio: any) =>
			Array.isArray(portfolio?.assets) ? portfolio.assets : []
		);

		return this.portfolioScoreService.compute(this.toPositions(assets));
	}

	/**
	 * POST /ai/asset-opinion
	 * Resumo estruturado de um ativo (summary/strength/attention/tags),
	 * substituindo o benchmark reimplementado no cliente e a chamada a
	 * /ai/chat generico que web/src/services/ai/assetOpinion.ts fazia.
	 * Determinístico, sem LLM — ver AssetOpinionService.
	 */
	@Post('asset-opinion')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	async assetOpinion(
		@Request() req: any,
		@Body() body: AssetOpinionRequestDto
	): Promise<AssetOpinionOutput> {
		const userId = String(req.user?.userId ?? req.user?.sub ?? '');
		if (!userId) {
			throw new UnauthorizedException('User ID ausente no token');
		}

		return this.assetOpinionService.getOpinion(userId, body.symbol);
	}

	/**
	 * GET /ai/error-radar
	 * "Radar Anti-Erro": alertas preventivos deterministicos (concentracao de
	 * ativo/classe/setor, diversificacao, volatilidade, beta) sobre a
	 * carteira do usuario autenticado. Sem corpo. Ver PortfolioErrorRadarService
	 * para o porque de nao incluir correlacao entre ativos ainda.
	 */
	@Get('error-radar')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	async errorRadar(@Request() req: any): Promise<PortfolioErrorRadarOutput> {
		const userId = String(req.user?.userId ?? req.user?.sub ?? '');
		if (!userId) {
			throw new UnauthorizedException('User ID ausente no token');
		}

		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const assets = portfolios.flatMap((portfolio: any) =>
			Array.isArray(portfolio?.assets) ? portfolio.assets : []
		);

		return this.portfolioErrorRadarService.detect(this.toPositions(assets));
	}

	/**
	 * POST /ai/opportunity-radar
	 * Expoe OpportunityRadarService.detect() diretamente (TRA-8), sem passar
	 * pelo Chat Inteligente. Antes so era alcancavel via POST
	 * /ai/chat/intelligent para intents especificos ("opportunity_radar"),
	 * o que forcava qualquer consumidor a simular uma pergunta de chat so
	 * pra ler o radar. Feature premium por definicao: mesmo gate de plano
	 * (USER_PLAN_RESOLVER / planAtLeast) usado pelo RAG do chat (TRA-79),
	 * aqui aplicado como 403 explicito em vez de fallback silencioso, ja
	 * que este e um endpoint dedicado consumido diretamente.
	 */
	@Post('opportunity-radar')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	async opportunityRadar(
		@Request() req: any,
		@Body() body: OpportunityRadarRequestDto
	): Promise<OpportunityRadarOutput> {
		const userId = String(req.user?.userId ?? req.user?.sub ?? '');
		if (!userId) {
			throw new UnauthorizedException('User ID ausente no token');
		}

		const plan = await this.userPlanResolver.resolve(userId);
		if (!planAtLeast(plan, 'premium')) {
			throw new ForbiddenException('FEATURE_PREMIUM_REQUERIDA');
		}

		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const assets = portfolios.flatMap((portfolio: any) =>
			Array.isArray(portfolio?.assets) ? portfolio.assets : []
		);
		const positions = this.toPositions(assets);

		return this.unifiedIntelligenceFacade.detectOpportunities({
			portfolioPositions: positions,
			candidateSymbols: body?.candidateSymbols,
			watchlistSymbols: body?.watchlistSymbols,
			sectorTargetAllocation: body?.sectorTargetAllocation,
			rules: body?.rules,
			fiscalContext: body?.fiscalContext,
		});
	}

	/**
	 * GET /ai/investor-profile
	 * Perfil de sofisticacao/tolerancia a risco do investidor autenticado,
	 * calculado deterministicamente a partir de sinais da carteira (spec
	 * 2026-08-27-ai-insights-adaptive-profile-redesign-design.md). Sem LLM.
	 */
	@Get('investor-profile')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	async investorProfile(
		@Request() req: any
	): Promise<InvestorSophisticationProfile> {
		const userId = String(req.user?.userId ?? req.user?.sub ?? '');
		if (!userId) {
			throw new UnauthorizedException('User ID ausente no token');
		}
		return this.investorProfileService.getEffectiveProfile(userId);
	}

	/**
	 * PUT /ai/investor-profile
	 * Override manual do usuario sobre o perfil inferido. Persiste ate o
	 * usuario resetar; o job diario continua recalculando o valor inferido
	 * em paralelo, sem sobrescrever o override.
	 */
	@Put('investor-profile')
	@UseGuards(JwtAuthGuard)
	@HttpCode(HttpStatus.OK)
	async updateInvestorProfile(
		@Request() req: any,
		@Body()
		body: InvestorProfileOverrideDto
	): Promise<InvestorSophisticationProfile> {
		const userId = String(req.user?.userId ?? req.user?.sub ?? '');
		if (!userId) {
			throw new UnauthorizedException('User ID ausente no token');
		}
		return this.investorProfileService.setOverride(userId, body || {});
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
		const userId = String(req.user?.userId ?? req.user?.id ?? '');
		if (!userId) {
			throw new UnauthorizedException('User ID ausente no token');
		}
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
				const topAsset = (data as any)?.portfolioRisk
					?.concentrationByAsset?.[0];
				const topConcentrationPct = Number(topAsset?.percentage ?? 0);
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
				if (
					Array.isArray(rebalanceSuggestion?.targetAllocationMix) &&
					rebalanceSuggestion.targetAllocationMix.length > 0
				) {
					const mixLabel = rebalanceSuggestion.targetAllocationMix
						.slice(0, 4)
						.map(
							(item: any) =>
								`${item.bucket}: ${Number(item.targetPct || 0).toFixed(0)}%`
						)
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
					typeof topAvoid === 'string' ? topAvoid : topAvoid?.symbol || null;
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
							const pctLabel = Number.isFinite(pct)
								? `${pct.toFixed(1)}%`
								: 'N/D';
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
		return (
			/\b(listar|liste|quais|mostrar|mostre|descrev\w*)\b/.test(text) &&
			/\b(ativos?|carteira|portf[oó]lio)\b/.test(text)
		);
	}

	private resolveConcentrationPct(entry: any): number {
		const weight = Number(entry?.weightPct);
		if (Number.isFinite(weight) && weight > 0) return weight;
		const percentage = Number(entry?.percentage);
		if (Number.isFinite(percentage) && percentage > 0) return percentage;
		return 0;
	}

	// Mesma conversao de ChatOrchestratorService.toPositions/normalizeTicker
	// (src/ai/orchestration/chat-orchestrator.service.ts). Duplicada em vez de
	// extraida para nao alterar aquele arquivo, ja fortemente coberto por
	// testes, so para ganhar um endpoint novo.
	private toPositions(assets: any[]): PortfolioIntelligencePosition[] {
		return assets
			.map((asset: any) => ({
				symbol: this.normalizeTicker(
					asset?.symbol || asset?.ticker || asset?.stock || asset?.code || ''
				),
				assetType: (asset?.type || 'other') as
					| 'stock'
					| 'fii'
					| 'crypto'
					| 'etf'
					| 'fund'
					| 'other',
				quantity: Number(asset?.quantity || 0),
				totalValue:
					typeof asset?.total === 'number' && asset.total > 0
						? asset.total
						: undefined,
				price: typeof asset?.price === 'number' ? asset.price : undefined,
				currentPrice:
					typeof asset?.currentPrice === 'number'
						? asset.currentPrice
						: undefined,
				sector: typeof asset?.sector === 'string' ? asset.sector : null,
				volatility:
					typeof asset?.volatility === 'number' ? asset.volatility : undefined,
				beta: typeof asset?.beta === 'number' ? asset.beta : undefined,
			}))
			.filter((position) => !!position.symbol);
	}

	private normalizeTicker(value: string): string {
		const normalized = String(value || '')
			.trim()
			.toUpperCase()
			.replace(/\s+/g, '');
		if (!normalized) return '';
		const withNoDollar = normalized.replace(/^\$/, '');
		const brWithSuffix = withNoDollar.match(/^([A-Z]{4}\d{1,2})\.(SA|B3)$/);
		if (brWithSuffix) return brWithSuffix[1];
		return withNoDollar;
	}
}
