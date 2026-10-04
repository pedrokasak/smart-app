import { Injectable, Logger } from '@nestjs/common';
import {
	ChatCostObservation,
	ChatCostObserverPort,
	ChatToolRoutingObservation,
} from 'src/ai/orchestration/chat-cost-observer.port';

/**
 * Observador de custo do chat. A rota determinística não gera linha: é o
 * caminho comum e não custa LLM. O roteador com tool-calling (TRA-241) gera
 * uma linha por pergunta, com latência, tokens e provider, para medir custo
 * no log do container sem guardar a pergunta.
 */
@Injectable()
export class LoggingChatCostObserverAdapter implements ChatCostObserverPort {
	private readonly logger = new Logger('ChatCost');

	record(observation: ChatCostObservation): void {
		void observation;
	}

	recordToolRouting(observation: ChatToolRoutingObservation): void {
		this.logger.log(
			`tool_routing trigger=${observation.trigger} outcome=${observation.outcome} ` +
				`calls=${observation.calls} intents=${observation.intents.join(',') || '-'} ` +
				`latency_ms=${observation.latencyMs} provider=${observation.provider ?? '-'} ` +
				`tokens_in=${observation.inputTokens} tokens_out=${observation.outputTokens}`
		);
	}
}
