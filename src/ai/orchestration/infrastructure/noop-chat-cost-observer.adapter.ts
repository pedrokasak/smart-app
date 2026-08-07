import { Injectable } from '@nestjs/common';
import {
	ChatCostObservation,
	ChatCostObserverPort,
} from 'src/ai/orchestration/chat-cost-observer.port';

@Injectable()
export class NoopChatCostObserverAdapter implements ChatCostObserverPort {
	record(observation: ChatCostObservation): void {
		// noop intencional: o observador existe apenas para satisfazer a porta
		// quando não há coleta de custo ativa. Marca o parâmetro como usado.
		void observation;
	}
}
