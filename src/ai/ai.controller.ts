import {
	Controller,
	Post,
	Body,
	UseGuards,
	Request,
	HttpCode,
	HttpStatus,
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

@Controller('ai')
@ApiTags('ai')
@ApiBearerAuth('access-token')
export class AiController {
	constructor(
		private readonly aiService: AiService,
		private readonly chatOrchestratorService: ChatOrchestratorService
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
		const orchestration = await this.chatOrchestratorService.orchestrate(
			userId,
			body?.question || ''
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
	}

	private buildIntelligentMessage(response: ChatOrchestratorResponse): string {
		const data = response.data || {};
		switch (response.intent) {
			case 'portfolio_risk': {
				const riskScore = (data as any)?.portfolioRisk?.risk?.score;
				return typeof riskScore === 'number'
					? `Análise de risco concluída. Score atual da carteira: ${riskScore.toFixed(1)}.`
					: 'Análise de risco da carteira concluída com os dados disponíveis.';
			}
			case 'tax_estimation':
			case 'sell_simulation': {
				const tax = (data as any)?.sellSimulation?.estimatedTax;
				return typeof tax === 'number'
					? `Simulação de venda concluída. Imposto estimado: R$ ${tax.toFixed(2)}.`
					: 'Simulação fiscal concluída com os dados disponíveis.';
			}
			case 'asset_comparison':
				return 'Comparação concluída com métricas de mercado e encaixe em carteira.';
			case 'external_asset_analysis':
				return 'Análise de ativo externo concluída com dados de mercado.';
			case 'portfolio_summary': {
				const totalValue = (data as any)?.portfolioSummary?.totalValue;
				return typeof totalValue === 'number'
					? `Resumo da carteira concluído. Valor total estimado: R$ ${totalValue.toFixed(2)}.`
					: 'Resumo da carteira concluído.';
			}
			default:
				return 'Análise concluída com dados estruturados e determinísticos.';
		}
	}
}
