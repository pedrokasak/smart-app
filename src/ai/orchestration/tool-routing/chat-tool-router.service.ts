import { Inject, Injectable, Logger } from '@nestjs/common';
import {
	CHAT_COST_OBSERVER,
	ChatCostObserverPort,
	ChatToolRoutingObservation,
} from 'src/ai/orchestration/chat-cost-observer.port';
import { ChatOrchestratorService } from 'src/ai/orchestration/chat-orchestrator.service';
import {
	ChatOrchestratorIntent,
	ChatOrchestratorResponse,
} from 'src/ai/orchestration/chat-orchestrator.types';
import {
	planHasCapability,
	USER_PLAN_RESOLVER,
	UserPlanResolverPort,
} from 'src/subscription/application/user-plan.types';
import { CHAT_TOOL_CATALOG } from './chat-tool-catalog';
import {
	CHAT_TOOL_PLANNER,
	ChatPlannedCall,
	ChatToolPlannerPort,
} from './chat-tool-planner.port';
import {
	CHAT_TOOL_ROUTER_CONFIG,
	ChatToolRouterConfig,
} from './chat-tool-router.config';
import {
	ChatToolRoutingTrigger,
	toolRoutingTrigger,
} from './chat-tool-routing.policy';

type OrchestrateOptions = NonNullable<
	Parameters<ChatOrchestratorService['orchestrate']>[2]
>;

/** Como a resposta foi roteada — campo aditivo na resposta do chat. */
export interface ChatRouting {
	mode: 'regex' | 'tool_calling';
	trigger: ChatToolRoutingTrigger | null;
	intents: ChatOrchestratorIntent[];
}

export interface ChatRoutedAnswer {
	/** Uma resposta por intenção; a primeira é a principal. */
	parts: ChatOrchestratorResponse[];
	routing: ChatRouting;
}

/** Intenções que não respondem a nada: parte assim é descartada. */
const NON_ANSWERS: ReadonlySet<ChatOrchestratorIntent> = new Set([
	'unknown',
	'narrative_synthesis',
]);

/**
 * Roteador do chat com tool-calling (TRA-241).
 *
 * 1. O regex responde primeiro, como sempre: sem custo nem latência.
 * 2. Só quando ele não reconhece a pergunta (`unknown`) ou quando a pergunta
 *    pede duas coisas, o LLM escolhe de 1 a 3 intenções existentes, com os
 *    tickers.
 * 3. Cada intenção roda pelo orquestrador de sempre: o número vem do código
 *    determinístico, nunca do LLM.
 * 4. Qualquer falha (flag desligada, plano sem `ai.rag`, trackerr-ia fora ou
 *    lento, nenhuma ferramenta útil) devolve a resposta do regex. O chat
 *    nunca fica pior do que era.
 */
@Injectable()
export class ChatToolRouterService {
	private readonly logger = new Logger(ChatToolRouterService.name);

	constructor(
		private readonly orchestrator: ChatOrchestratorService,
		@Inject(CHAT_TOOL_PLANNER) private readonly planner: ChatToolPlannerPort,
		@Inject(USER_PLAN_RESOLVER)
		private readonly userPlanResolver: UserPlanResolverPort,
		@Inject(CHAT_COST_OBSERVER)
		private readonly costObserver: ChatCostObserverPort,
		@Inject(CHAT_TOOL_ROUTER_CONFIG)
		private readonly config: ChatToolRouterConfig
	) {}

	async answer(
		userId: string,
		question: string,
		options: OrchestrateOptions = {}
	): Promise<ChatRoutedAnswer> {
		const primary = await this.orchestrator.orchestrate(
			userId,
			question,
			options
		);
		const regexOnly: ChatRoutedAnswer = {
			parts: [primary],
			routing: { mode: 'regex', trigger: null, intents: [primary.intent] },
		};

		// Fluxos do Copiloto (vender, rebalancear, comitê) já dizem a intenção.
		if (!this.config.enabled || options.copilotFlow || options.decisionFlow) {
			return regexOnly;
		}
		const trigger = toolRoutingTrigger(question, primary.intent);
		if (!trigger || !(await this.canUseLlm(userId))) return regexOnly;

		const started = Date.now();
		let plan;
		try {
			plan = await this.planner.plan({
				question,
				tools: CHAT_TOOL_CATALOG,
				maxCalls: this.config.maxCalls,
			});
		} catch (err) {
			this.logger.warn(
				`Roteador do chat indisponivel, seguindo pelo regex: ${err instanceof Error ? err.message : String(err)}`
			);
			this.observe({
				trigger,
				outcome: 'failed',
				calls: 0,
				intents: [],
				latencyMs: Date.now() - started,
				provider: null,
				inputTokens: 0,
				outputTokens: 0,
			});
			return regexOnly;
		}

		const usage = {
			provider: plan.provider,
			inputTokens: plan.inputTokens,
			outputTokens: plan.outputTokens,
		};
		if (!plan.calls.length) {
			this.observe({
				trigger,
				outcome: plan.reason === 'not_supported' ? 'not_supported' : 'no_tool',
				calls: 0,
				intents: [],
				latencyMs: Date.now() - started,
				...usage,
			});
			return regexOnly;
		}

		const executed = await this.execute(
			userId,
			question,
			options,
			primary,
			plan.calls
		);
		// Pergunta com dois pedidos: a parte que o regex já respondeu fica,
		// mesmo que o LLM tenha escolhido só a outra — o roteador soma,
		// nunca troca uma resposta certa por outra.
		const parts =
			trigger === 'multi_intent' && !executed.includes(primary)
				? [primary, ...executed]
				: executed;
		const intents = parts.map((part) => part.intent);
		this.observe({
			trigger,
			outcome: parts.length ? 'routed' : 'unusable',
			calls: plan.calls.length,
			intents,
			latencyMs: Date.now() - started,
			...usage,
		});
		if (!parts.length) return regexOnly;
		return { parts, routing: { mode: 'tool_calling', trigger, intents } };
	}

	/**
	 * Roda cada intenção escolhida pelo orquestrador. A que o regex já
	 * respondeu não roda de novo; a que cai sem dado (intenção que pede
	 * ticker, sem ticker) é descartada.
	 */
	private async execute(
		userId: string,
		question: string,
		options: OrchestrateOptions,
		primary: ChatOrchestratorResponse,
		calls: ChatPlannedCall[]
	): Promise<ChatOrchestratorResponse[]> {
		const parts: ChatOrchestratorResponse[] = [];
		const seen = new Set<ChatOrchestratorIntent>();
		for (const call of calls) {
			if (seen.has(call.intent)) continue;
			seen.add(call.intent);
			if (call.intent === primary.intent && !NON_ANSWERS.has(primary.intent)) {
				parts.push(primary);
				continue;
			}
			try {
				const part = await this.orchestrator.orchestrate(userId, question, {
					...options,
					plannedCall: { intent: call.intent, symbols: call.tickers },
				});
				if (!NON_ANSWERS.has(part.intent)) parts.push(part);
			} catch (err) {
				this.logger.warn(
					`Roteador do chat: intencao ${call.intent} falhou: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}
		return parts;
	}

	/**
	 * O roteador gasta LLM: mesma capability do Copiloto com RAG (`ai.rag`).
	 * Na dúvida (consulta falhou), sem LLM — o regex responde.
	 */
	private async canUseLlm(userId: string): Promise<boolean> {
		try {
			const access =
				await this.userPlanResolver.resolveWithCapabilities(userId);
			return planHasCapability(
				access.capabilities,
				'ai.rag',
				access.tier,
				access.capabilitiesKnown
			);
		} catch {
			return false;
		}
	}

	private observe(observation: ChatToolRoutingObservation): void {
		try {
			// Observador assíncrono que rejeite também não pode derrubar nada.
			void Promise.resolve(
				this.costObserver.recordToolRouting?.(observation)
			).catch(() => undefined);
		} catch {
			// Observabilidade nunca derruba a resposta.
		}
	}
}
