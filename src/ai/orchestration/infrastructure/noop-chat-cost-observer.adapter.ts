import { Injectable } from '@nestjs/common';
import { ChatCostObservation, ChatCostObserverPort } from 'src/ai/orchestration/chat-cost-observer.port';

@Injectable()
export class NoopChatCostObserverAdapter implements ChatCostObserverPort {
	record(_observation: ChatCostObservation): void {}
}

