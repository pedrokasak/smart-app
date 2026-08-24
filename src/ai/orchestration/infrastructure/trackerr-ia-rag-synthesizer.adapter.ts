import { HttpService } from '@nestjs/axios';
import { trackerrIaHeaders } from 'src/ai/infrastructure/trackerr-ia-request';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
	ChatNarrativeSynthesisInput,
	ChatNarrativeSynthesisOutput,
	ChatNarrativeSynthesizerPort,
} from 'src/ai/orchestration/chat-narrative-synthesizer.port';
import {
	planAtLeast,
	USER_PLAN_RESOLVER,
	UserPlanResolverPort,
} from 'src/subscription/application/user-plan.types';

/**
 * Sintetizador narrativo do chat via RAG do trackerr-ia (TRA-76).
 *
 * Preenche o `CHAT_NARRATIVE_SYNTHESIZER`, que era um port projetado e
 * deixado sem implementacao — ate aqui toda pergunta que exigia sintese caia
 * no fallback deterministico. Isto liga o RAG como uma SKILL do orquestrador,
 * nao como cerebro: quem classifica a intent e decide a rota continua sendo o
 * `classifyIntent` deterministico, intocado. O RAG so entra depois, no ramo
 * `synthesis_required`, pras perguntas abertas que o roteamento deterministico
 * ja decidiu que precisam de narrativa.
 *
 * Principio das duas fontes (TRA-10): o server estabelece FATOS
 * deterministicos; o trackerr-ia RECUPERA e NARRA. Por isso este adapter
 * delega a `/api/rag/query`, que ja embeda, recupera com isolamento por
 * usuario, aplica os guardrails e anexa o disclaimer (TRA-37). Reconstruir
 * essa protecao no server duplicaria a logica de guard.
 *
 * Contrato de fallback: devolve `{ text: '' }` sempre que NAO deve narrar —
 * plano sem acesso a IA, RAG sem contexto pro usuario, ou falha de rede. O
 * `ChatNarrativeSynthesisService` trata texto vazio como sinal de cair na
 * narrativa deterministica. Erro nunca vira excecao pro chamador no caminho
 * normal: pergunta sem contexto de RAG e caso esperado, nao falha.
 */
@Injectable()
export class TrackerrIaRagSynthesizerAdapter implements ChatNarrativeSynthesizerPort {
	private readonly logger = new Logger(TrackerrIaRagSynthesizerAdapter.name);
	private readonly trackerIaUrl =
		process.env.TRAKKER_IA_URL || 'http://localhost:8000';

	private static readonly EMPTY: ChatNarrativeSynthesisOutput = { text: '' };

	constructor(
		private readonly httpService: HttpService,
		@Inject(USER_PLAN_RESOLVER)
		private readonly userPlanResolver: UserPlanResolverPort
	) {}

	async synthesize(
		input: ChatNarrativeSynthesisInput
	): Promise<ChatNarrativeSynthesisOutput> {
		if (!input.userId || !input.question) {
			return TrackerrIaRagSynthesizerAdapter.EMPTY;
		}

		// Gate de custo (TRA-76): rodar RAG pra usuario Free e custo puro — ele
		// nao tem acesso ao recurso. O plano vem da assinatura (TRA-79), nao da
		// carteira.
		const plan = await this.userPlanResolver.resolve(input.userId);
		if (!planAtLeast(plan, 'pro')) {
			return TrackerrIaRagSynthesizerAdapter.EMPTY;
		}

		try {
			const response = await firstValueFrom(
				this.httpService.post<{
					answer: string;
					source: 'ai' | 'no_context' | 'guard_rejected';
					chunk_count: number;
				}>(
					`${this.trackerIaUrl}/api/rag/query`,
					{ user_id: input.userId, question: input.question },
					{
						headers: trackerrIaHeaders(),
						timeout: 12000,
					}
				)
			);

			// So aproveita quando o RAG realmente narrou em cima de contexto do
			// usuario. `no_context` (nada ingerido pra ele) e `guard_rejected`
			// (resposta bloqueada pelos guardrails) caem no fallback
			// deterministico — melhor uma narrativa generica honesta que uma
			// resposta vazia disfarcada.
			if (response.data?.source === 'ai' && response.data.answer?.trim()) {
				return {
					text: response.data.answer,
					metadata: { model: 'trackerr-ia-rag' },
				};
			}
			return TrackerrIaRagSynthesizerAdapter.EMPTY;
		} catch (error) {
			this.logger.warn(
				`Falha ao sintetizar via RAG do trackerr-ia: ${error?.message}; usando fallback determinístico.`
			);
			return TrackerrIaRagSynthesizerAdapter.EMPTY;
		}
	}
}
