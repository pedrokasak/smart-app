import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEvent, EventHandler } from 'src/events/domain/domain-event';
import { EventPublisher } from 'src/events/application/ports/event-publisher.port';
import { EventSubscriber } from 'src/events/application/ports/event-subscriber.port';

/**
 * Adaptador in-process das portas EventPublisher/EventSubscriber (TRA-136).
 *
 * E o UNICO arquivo do modulo que conhece `@nestjs/event-emitter`. Trocar
 * por Kafka/NATS/HTTP significa escrever outro adaptador e reapontar o
 * provider de EVENT_PUBLISHER — nenhum produtor muda.
 *
 * O casamento de padrao (`*`, `**`, delimitador `.`) e o proprio do
 * EventEmitter2, configurado em `EventEmitterModule.forRoot` no
 * `EventsModule`. A semantica documentada na porta e exatamente essa.
 *
 * Publicar nunca lanca: um assinante quebrado (ou o Redis fora do ar dentro
 * de um assinante que enfileira) nao pode derrubar o request que produziu o
 * evento. Falha de assinante e logada, nunca propagada.
 */
@Injectable()
export class InProcessEventBus implements EventPublisher, EventSubscriber {
	private readonly logger = new Logger(InProcessEventBus.name);

	constructor(private readonly emitter: EventEmitter2) {}

	async publish<T>(event: DomainEvent<T>): Promise<void> {
		try {
			await this.emitter.emitAsync(event.type, event);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(
				`Assinante falhou ao processar ${event.type} (id=${event.id}): ${message}`
			);
		}
	}

	subscribe(pattern: string, handler: EventHandler): void {
		// `emitAsync` agrega o retorno de cada listener num Promise.all, entao
		// devolver a promise do handler basta para que publish() so resolva
		// depois que todos os assinantes terminarem.
		this.emitter.on(pattern, (event: DomainEvent) => handler(event));
	}
}
