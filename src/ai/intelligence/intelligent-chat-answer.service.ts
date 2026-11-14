import {
	Injectable,
	Logger,
	NotFoundException,
	Optional,
} from '@nestjs/common';
import { ChatConversationService } from 'src/ai/chat-history/chat-conversation.service';
import { ChatHistoryService } from 'src/ai/chat-history/chat-history.service';
import { resolveFollowUpQuestion } from './follow-up-question';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import {
	buildAnswerSources,
	computeAnswerConfidence,
	mergeAnswerConfidence,
} from '../orchestration/answer-confidence';
import { PORTFOLIO_FILTER_IGNORED } from '../orchestration/chat-orchestrator.service';
import { ChatOrchestratorResponse } from '../orchestration/chat-orchestrator.types';
import { isPortfolioAssetListQuestion } from '../orchestration/portfolio-asset-list-question';
import { ChatToolRouterService } from '../orchestration/tool-routing/chat-tool-router.service';
import { CopilotDidacticService } from '../didactic/copilot-didactic.service';
import { IntelligentChatRequestDto } from './dto/intelligent-chat-request.dto';

/**
 * Resposta do Chat Inteligente, compartilhada entre o chat de texto
 * (`POST /ai/chat/intelligent`) e a voz (`POST /ai/voice/answer`, ADR-007).
 *
 * Vivia dentro do `AiController`. Saiu dele para a voz usar exatamente o
 * mesmo caminho do texto: uma melhoria no orquestrador vale para os dois
 * canais, e regra de negócio deixa de morar no controller.
 */
@Injectable()
export class IntelligentChatAnswerService {
	private readonly logger = new Logger(IntelligentChatAnswerService.name);

	constructor(
		private readonly chatToolRouter: ChatToolRouterService,
		private readonly copilotDidactic: CopilotDidacticService,
		private readonly portfolios: PortfolioService,
		// Opcionais: sem eles (testes antigos), a pergunta vai como veio.
		@Optional() private readonly conversations?: ChatConversationService,
		@Optional() private readonly history?: ChatHistoryService
	) {}

	async answer(
		userId: string,
		body: Pick<
			IntelligentChatRequestDto,
			| 'question'
			| 'investorProfile'
			| 'copilotFlow'
			| 'decisionFlow'
			| 'portfolioId'
			| 'conversationId'
		>
	): Promise<any> {
		// Fora do try: carteira de outro usuário é erro do pedido (404), não
		// falha do orquestrador para virar resposta genérica.
		const portfolioId = await this.ownedPortfolioId(userId, body?.portfolioId);
		const question = await this.withConversationContext(
			userId,
			body?.question || '',
			body?.conversationId
		);
		try {
			const { parts, routing } = await this.chatToolRouter.answer(
				userId,
				question,
				{
					investorProfile: body?.investorProfile,
					copilotFlow: body?.copilotFlow,
					decisionFlow: body?.decisionFlow,
					// Sem carteira escolhida, as opções ficam como sempre foram.
					...(portfolioId ? { portfolioId } : {}),
				}
			);
			const [orchestration] = parts;
			const union = (pick: (part: ChatOrchestratorResponse) => string[]) =>
				Array.from(new Set(parts.flatMap(pick)));
			const explained = await this.copilotDidactic.explain(
				userId,
				body?.question || '',
				parts
			);
			return {
				intent: orchestration.intent,
				deterministic: orchestration.deterministic,
				route: orchestration.route,
				// Uma intenção por parágrafo (TRA-241). Com compositor didático,
				// a explicação no nível da pessoa; sem ele, a mensagem de sempre.
				message: this.withScopeNote(
					parts
						.map(
							(part, index) =>
								explained[index].message ?? this.buildIntelligentMessage(part)
						)
						.join('\n\n'),
					parts
				),
				// Campo aditivo: blocos estruturados para a bolha didática do web
				// (docs/requisitos/ia-didatica.md), um por parte com compositor,
				// na ordem dos parágrafos. Vazio quando nenhuma parte tem.
				didactic: explained.flatMap((entry) =>
					entry.didactic ? [entry.didactic] : []
				),
				data: Object.assign({}, ...parts.map((part) => part.data)),
				unavailable: union((part) => part.unavailable),
				warnings: union((part) => part.warnings),
				assumptions: union((part) => part.assumptions),
				// "confiança 92%" e chips de fonte da bolha do handoff (TRA-141).
				// Este endpoint não passa pelo RAG: toda resposta aqui é
				// determinística, e a confiança mede a cobertura do dado. Com
				// mais de uma parte, vale a menor.
				confidence: mergeAnswerConfidence(
					parts.map((part) =>
						computeAnswerConfidence({
							routeType: part.route.type,
							routeReason: part.route.reason,
							unavailable: part.unavailable,
							assumptions: part.assumptions,
						})
					)
				),
				sources: union((part) =>
					buildAnswerSources({
						intent: part.intent,
						positionsCount: part.context?.positionsCount ?? 0,
						data: part.data,
					})
				),
				// Campo aditivo: o web ignora; serve a suporte e avaliação.
				routing,
				// Carteira usada na resposta; o histórico guarda junto.
				portfolioId: portfolioId ?? null,
				// Pergunta que o orquestrador respondeu, quando o seguimento a
				// reescreveu ("e a VALE3?"). O web pode mostrar o que entendeu.
				...(question !== String(body?.question || '').trim()
					? { resolvedQuestion: question }
					: {}),
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
	 * Contexto da conversa (ADR-007, fase 2): confere o dono (404) e
	 * reescreve a pergunta de seguimento com a anterior da mesma conversa.
	 */
	private async withConversationContext(
		userId: string,
		question: string,
		conversationId?: string
	): Promise<string> {
		if (!conversationId || !this.conversations || !this.history) {
			return question.trim();
		}
		await this.conversations.ensureOwned(userId, conversationId);
		const previous = await this.history.lastUserQuestion(
			userId,
			conversationId
		);
		return resolveFollowUpQuestion(question, previous);
	}

	/**
	 * Confere que a carteira é do usuário (ADR-007, decisão 10). De outro
	 * usuário ou inexistente, o mesmo 404, sem dizer qual dos dois.
	 */
	private async ownedPortfolioId(
		userId: string,
		portfolioId?: string | null
	): Promise<string | null> {
		if (!portfolioId) return null;
		const owned = await this.portfolios.getUserPortfolios(userId);
		if (
			!owned.some((portfolio: any) => String(portfolio?._id) === portfolioId)
		) {
			throw new NotFoundException('portfolio_not_found');
		}
		return portfolioId;
	}

	/** Diz quando uma parte respondeu sobre todas as carteiras apesar do filtro. */
	private withScopeNote(
		message: string,
		parts: ChatOrchestratorResponse[]
	): string {
		const ignored = parts.some((part) =>
			part.warnings?.includes(PORTFOLIO_FILTER_IGNORED)
		);
		return ignored
			? `${message}\n\nEsta resposta considera todas as suas carteiras.`
			: message;
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

		// Formatação pt-BR dos números das análises do Copiloto (TRA-141).
		const ptBr2 = (value: number) =>
			value.toLocaleString('pt-BR', {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			});
		const signedPct = (fraction: number) => {
			const pct = fraction * 100;
			const sign = pct > 0 ? '+' : pct < 0 ? '-' : '';
			return `${sign}${Math.abs(pct).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
		};
		const signedPp = (fraction: number) =>
			signedPct(fraction).replace('%', ' p.p.');
		const ptBr1 = (value: number) =>
			Number(value).toLocaleString('pt-BR', {
				minimumFractionDigits: 1,
				maximumFractionDigits: 1,
			});
		const money = (value: number) =>
			new Intl.NumberFormat('pt-BR', {
				style: 'currency',
				currency: 'BRL',
				maximumFractionDigits: 0,
			}).format(Number(value) || 0);
		const BUCKET_LABEL: Record<string, string> = {
			stocks: 'Ações',
			crypto: 'Cripto',
			fiis: 'FIIs',
			other: 'Outros',
		};

		switch (response.intent) {
			case 'ri_question':
				return this.buildRiAnswerMessage(response);
			case 'correlation_matrix': {
				const matrix = (data as any)?.correlationMatrix;
				const symbols: string[] = matrix?.symbols || [];
				const missing: string[] = matrix?.missingSymbols || [];
				if (symbols.length < 2 || matrix?.averageCorrelation == null) {
					return 'Preciso de pelo menos dois ativos listados na B3 com um ano de histórico de preço para montar a matriz de correlação.';
				}
				const average = Number(matrix.averageCorrelation);
				let msg = `Correlação média entre os ${symbols.length} ativos: ${ptBr2(average)}.`;
				const high = matrix?.highestPair;
				const low = matrix?.lowestPair;
				if (high?.correlation != null) {
					msg += ` O par que mais anda junto é ${high.a} e ${high.b} (${ptBr2(high.correlation)}).`;
				}
				if (low?.correlation != null) {
					msg += ` O que mais se descola é ${low.a} e ${low.b} (${ptBr2(low.correlation)}).`;
				}
				if (average >= 0.6) {
					msg +=
						' A carteira se move muito em bloco: a diversificação entre esses ativos é menor do que o número de posições sugere.';
				} else if (average <= 0.3) {
					msg +=
						' Os ativos se movem de forma bastante independente, o que ajuda a amortecer quedas.';
				}
				if (missing.length) {
					msg += ` Sem histórico suficiente para entrar na conta: ${missing.join(', ')}.`;
				}
				return msg;
			}
			case 'return_attribution': {
				const attribution = (data as any)?.returnAttribution;
				const rows: any[] = attribution?.rows || [];
				if (!rows.length || attribution?.totalReturn == null) {
					return 'Não encontrei histórico de preço suficiente para atribuir o retorno por ativo nos últimos 12 meses.';
				}
				let msg = `Comprando e segurando a carteira de hoje nos últimos 12 meses, o retorno seria de ${signedPct(Number(attribution.totalReturn))}.`;
				const top = attribution.topContributor;
				if (top) {
					msg += ` Quem mais contribuiu foi ${top.symbol} (${signedPp(Number(top.contribution))}).`;
				}
				const detractor = attribution.topDetractor;
				if (detractor) {
					msg += ` Quem mais tirou foi ${detractor.symbol} (${signedPp(Number(detractor.contribution))}).`;
				}
				// A premissa é dita, não deixada implícita.
				msg +=
					' Aportes e vendas feitos no período não entram nesta conta — para o retorno que você teve de fato, veja a rentabilidade (TWR).';
				return msg;
			}
			case 'allocation_gap': {
				const rebalancing = (data as any)?.rebalancing;
				if (!rebalancing?.hasTarget) {
					return 'Você ainda não definiu uma meta de alocação. Configure a política de investimento para eu medir onde a carteira está fora do alvo.';
				}
				const offTarget = (rebalancing.buckets || [])
					.filter((bucket: any) => Math.abs(Number(bucket.gapPct)) > 0.05)
					.sort((a: any, b: any) => Math.abs(b.gapPct) - Math.abs(a.gapPct));
				if (!offTarget.length) {
					return 'Sua carteira está alinhada à meta de alocação. Nenhuma classe está fora do alvo.';
				}
				const lines = offTarget.map((bucket: any) => {
					// Convenção do handoff: atual − alvo. Positivo = acima da meta.
					const deviation = -Number(bucket.gapPct) / 100;
					const action = bucket.gapPct < 0 ? 'reduzir' : 'comprar';
					return `${BUCKET_LABEL[bucket.bucket] || bucket.bucket}: ${signedPp(deviation)} (${action} ${money(Math.abs(bucket.amount))})`;
				});
				return `Onde a carteira está fora do alvo:\n${lines.join('\n')}`;
			}
			case 'contribution_simulation': {
				const simulation = (data as any)?.contributionSimulation;
				if (!(data as any)?.rebalancing?.hasTarget) {
					return 'Para simular o aporte preciso da sua meta de alocação. Configure a política de investimento e pergunte de novo.';
				}
				if (!simulation) {
					return 'Qual o valor do aporte? Por exemplo: "Simular aporte de R$ 20k".';
				}
				const lines = (simulation.slices || []).map(
					(slice: any) =>
						`${BUCKET_LABEL[slice.bucket] || slice.bucket}: ${money(slice.amount)}`
				);
				return `Para aportar ${money(simulation.contribution)} sem vender nada:\n${lines.join('\n')}\nO desvio total da meta cai de ${ptBr1(simulation.driftBeforePct)} p.p. para ${ptBr1(simulation.driftAfterPct)} p.p.`;
			}
			case 'dividends_received': {
				const received = (data as any)?.dividendsReceived;
				if (!received) {
					return 'Ainda não tenho o histórico de proventos dos seus ativos. Ele é carregado junto com as cotações — tente de novo mais tarde.';
				}
				let msg = `Nos últimos 12 meses seus ativos pagaram cerca de ${money(received.total12m)} em proventos.`;
				const payers: any[] = received.topPayers || [];
				if (payers.length) {
					msg += ` Quem mais pagou: ${payers
						.map((payer) => `${payer.symbol} (${money(payer.amount)})`)
						.join(', ')}.`;
				}
				// A premissa é dita, não deixada implícita.
				msg +=
					' A conta usa a quantidade que você tem hoje; se comprou parte das cotas no meio do período, o valor real recebido é menor.';
				return msg;
			}
			case 'trade_history': {
				const history = (data as any)?.tradeHistory;
				if (!history) {
					return 'Não consegui consultar as suas operações agora. Tente de novo em instantes.';
				}
				const subject = history.query?.symbol
					? ` de ${history.query.symbol}`
					: '';
				const period = history.query?.periodLabel
					? ` em ${history.query.periodLabel}`
					: '';
				if (!history.count) {
					return `Não encontrei operações${subject}${period} nas suas notas e extratos importados. Se você operou nesse período, importe a nota de corretagem ou o extrato de negociação da B3.`;
				}
				const qty = (value: number) =>
					value.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
				const parts: string[] = [];
				if (history.buys.count) {
					parts.push(
						`${history.buys.count} ${history.buys.count === 1 ? 'compra' : 'compras'} (${qty(history.buys.quantity)} unidades, ${money(history.buys.total)})`
					);
				}
				if (history.sells.count) {
					parts.push(
						`${history.sells.count} ${history.sells.count === 1 ? 'venda' : 'vendas'} (${qty(history.sells.quantity)} unidades, ${money(history.sells.total)})`
					);
				}
				let msg = `Nas suas operações importadas${subject}${period}: ${parts.join(' e ')}.`;
				if (history.fees > 0) msg += ` Custos somados: ${money(history.fees)}.`;
				const lines = (history.items || []).map((item: any) => {
					const [y, m, d] = String(item.date).split('-');
					return `• ${d}/${m}/${y} · ${item.side === 'sell' ? 'venda' : 'compra'} de ${item.symbol}: ${qty(item.quantity)} a ${money(item.price)}`;
				});
				if (lines.length) {
					msg += `\n${history.truncated ? 'As mais recentes:' : 'Operações:'}\n${lines.join('\n')}`;
				}
				return msg;
			}
			case 'action_checklist': {
				const checklist = (data as any)?.actionChecklist;
				const items: any[] = checklist?.items || [];
				if (!items.length) {
					return 'Nada exige ação hoje. Sua carteira está dentro da meta e sem concentração relevante em um único ativo.';
				}
				const lines = items.map((item) => {
					const detail = JSON.parse(item.detail || '{}');
					if (item.kind === 'rebalance') {
						return `• ${BUCKET_LABEL[detail.bucket] || detail.bucket} está ${signedPp(detail.deviationPp / 100)} fora da meta — rebalanceamento de ${money(detail.amount)}.`;
					}
					return `• ${detail.symbol} responde por ${ptBr1(detail.weightPct)}% da carteira — uma notícia dessa empresa mexe no resultado inteiro.`;
				});
				return `Pontos de atenção, sem urgência de mercado:\n${lines.join('\n')}`;
			}
			case 'unsupported_quant_analysis': {
				return 'Ainda não calculo VaR decomposto por fator nem otimização de carry fiscal. Posso mostrar o risco e a concentração da carteira, a correlação entre as posições ou a atribuição de retorno dos últimos 12 meses.';
			}
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
				if (isPortfolioAssetListQuestion(response.question)) {
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

	/**
	 * Resposta do acervo de RI (TRA-264) no texto da bolha: cada afirmacao
	 * com o documento e a pagina de onde saiu. Os documentos tambem viram os
	 * chips de fonte (`buildAnswerSources`) — nada de componente novo no web.
	 * Informativo, com fonte e sem recomendacao (CVM 20).
	 */
	private buildRiAnswerMessage(response: ChatOrchestratorResponse): string {
		if (response.route.reason === 'capability_not_available') {
			return 'Responder com base nos documentos de RI da empresa faz parte dos planos com resumo de RI por IA.';
		}
		if (response.warnings?.includes('ri_knowledge_unavailable')) {
			return 'Não consegui consultar os documentos de RI agora. Tente de novo em instantes.';
		}

		const answer = (response.data as any)?.riAnswer as
			| {
					ticker?: string;
					items?: {
						text: string;
						citation: {
							title: string;
							publishedAt: string;
							page: number | null;
						};
					}[];
			  }
			| undefined;
		const of = answer?.ticker ? ` de ${answer.ticker}` : '';
		const items = answer?.items ?? [];
		if (!items.length) {
			return (
				`Não encontrei isso nos documentos de RI${of} que tenho no acervo. ` +
				'O acervo reúne os documentos recentes das ações que estão em carteira.'
			);
		}

		const day = (iso: string) => {
			const [year, month, dayOfMonth] = String(iso || '').split('-');
			return year && month && dayOfMonth
				? `${dayOfMonth.slice(0, 2)}/${month}/${year}`
				: iso;
		};
		const lines = items.map(({ text, citation }) => {
			const page = citation.page ? `, p. ${citation.page}` : '';
			return `• ${text} (${citation.title}, ${day(citation.publishedAt)}${page})`;
		});
		return [
			`Segundo os documentos de RI${of}:`,
			...lines,
			'Informação extraída dos documentos entregues à CVM; não é recomendação de investimento.',
		].join('\n');
	}
}
