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
import { RagColdStartService } from 'src/ai/rag-ingestion/application/rag-cold-start.service';
import { TrackerrScoreService } from 'src/intelligence/application/trackerr-score.service';
import { AssetOpinionService } from 'src/intelligence/application/asset-opinion.service';
import { AssetOpinionOutput } from 'src/intelligence/application/asset-opinion.types';
import { AssetOpinionRequestDto } from './dto/asset-opinion-request.dto';
import { PortfolioScoreService } from 'src/intelligence/application/portfolio-score.service';
import { PortfolioErrorRadarOutput } from 'src/intelligence/application/portfolio-error-radar.types';
import { UserErrorRadarService } from 'src/intelligence/application/user-error-radar.service';
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
import { enrichPayloadWithProfile } from './analysis/enrich-payload-with-profile';
import { ChatHistoryService } from 'src/ai/chat-history/chat-history.service';
import { AppendChatMessageRequestDto } from 'src/ai/chat-history/dto/append-chat-message-request.dto';
import { ChatMessage } from 'src/ai/chat-history/schema/chat-message.schema';
import { OpportunityRadarRequestDto } from './dto/opportunity-radar-request.dto';
import { RequiresCapability } from 'src/subscription/capabilities/requires-capability.decorator';
import { didacticLevelFrom } from './didactic/didactic.types';
import { IntelligentChatAnswerService } from './intelligence/intelligent-chat-answer.service';

@Controller('ai')
@ApiTags('ai')
@ApiBearerAuth('access-token')
export class AiController {
	private readonly logger = new Logger(AiController.name);

	constructor(
		private readonly aiService: AiService,
		// Regex primeiro; tool-calling só quando ele não resolve (TRA-241).
		private readonly trackerrScoreService: TrackerrScoreService,
		private readonly portfolioScoreService: PortfolioScoreService,
		private readonly userErrorRadarService: UserErrorRadarService,
		private readonly assetOpinionService: AssetOpinionService,
		private readonly unifiedIntelligenceFacade: UnifiedIntelligenceFacade,
		private readonly portfolioService: PortfolioService,
		private readonly ragColdStart: RagColdStartService,
		private readonly investorProfileService: InvestorProfileService,
		private readonly chatHistoryService: ChatHistoryService,
		private readonly chatAnswer: IntelligentChatAnswerService
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

		// Monta o payload completo para o trakker-ia. O frontend pode enviar o
		// portfólio já formatado; o servidor completa com userId e com o perfil
		// do investidor (TRA-142).
		//
		// O perfil é best-effort: se a leitura falhar, a análise continua sem os
		// campos de perfil em vez de derrubar a requisição inteira. O texto sai
		// menos personalizado, não sai errado.
		let profile: InvestorSophisticationProfile | null = null;
		try {
			profile = await this.investorProfileService.getEffectiveProfile(userId);
		} catch (error: any) {
			this.logger.warn(
				`analyze: perfil de investidor indisponível para ${userId}: ${error?.message || 'unknown_error'}`
			);
		}

		const payload = enrichPayloadWithProfile({ body, userId, profile });

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
		// O "por que" de cada insight sai no nível da pessoa (IA didática).
		// Best-effort: sem perfil, o trackerr-ia usa o intermediário.
		const level = await this.investorProfileService
			.getEffectiveProfile(userId)
			.then((profile) => didacticLevelFrom(profile?.sophistication))
			.catch(() => undefined);
		return this.aiService.getInsights(
			userProfile,
			body?.data_freshness_days,
			level ? { level } : undefined
		);
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
		return this.chatAnswer.answer(userId, body);
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

		// Com a política e o custo do usuário: cada alerta traz número, limite
		// e a venda que volta ao limite (Insights IA).
		return this.userErrorRadarService.detect(
			userId,
			assets,
			this.toPositions(assets)
		);
	}

	/**
	 * POST /ai/opportunity-radar
	 * Expoe OpportunityRadarService.detect() diretamente (TRA-8), sem passar
	 * pelo Chat Inteligente. Antes so era alcancavel via POST
	 * /ai/chat/intelligent para intents especificos ("opportunity_radar"),
	 * o que forcava qualquer consumidor a simular uma pergunta de chat so
	 * pra ler o radar. Feature premium por definicao: gate declarativo
	 * `ai.insights` (TRA-193), 403 explicito em vez do fallback silencioso do
	 * RAG no chat, ja que este e um endpoint dedicado consumido diretamente.
	 */
	@RequiresCapability('ai.insights')
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
