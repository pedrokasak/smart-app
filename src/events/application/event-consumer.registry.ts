import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { matchesEventPattern } from 'src/events/domain/event-pattern';
import { EVENT_CONSUMERS, EventConsumer } from './ports/event-consumer.port';

/**
 * Registro de consumidores da fila (TRA-136, fase 3).
 *
 * A fase 2 injetava a lista de consumidores direto no worker, por um
 * provider estatico. Isso funciona enquanto os consumidores moram no
 * proprio EventsModule — e para de funcionar no momento em que um
 * consumidor precisa de dependencia de outro dominio (o de notificacao
 * precisa do NotificationsService). Fazer o EventsModule importar
 * NotificationsModule inverteria o acoplamento que a fase 1 construiu:
 * o transporte passaria a conhecer o dominio.
 *
 * O registro resolve isso pela direcao certa. O modulo de dominio provee
 * seu consumidor e o registra aqui no bootstrap; o worker consulta o
 * registro na hora de processar o job, nunca no construtor.
 *
 * `EVENT_CONSUMERS` continua existindo como semente, para consumidores que
 * de fato pertencam ao EventsModule.
 */
@Injectable()
export class EventConsumerRegistry {
	private readonly logger = new Logger(EventConsumerRegistry.name);
	private readonly consumers: EventConsumer[] = [];

	constructor(
		@Optional()
		@Inject(EVENT_CONSUMERS)
		seed: EventConsumer[] = []
	) {
		for (const consumer of seed ?? []) {
			this.register(consumer);
		}
	}

	/**
	 * Idempotente por `name`. Registrar duas vezes o mesmo consumidor
	 * (hot-reload em dev, modulo instanciado duas vezes) rodaria o efeito
	 * colateral duas vezes por evento — exatamente o que a idempotencia do
	 * consumidor existe para evitar.
	 */
	register(consumer: EventConsumer): void {
		if (this.consumers.some((c) => c.name === consumer.name)) {
			this.logger.warn(
				`Consumidor '${consumer.name}' ja registrado — ignorando duplicata`
			);
			return;
		}
		this.consumers.push(consumer);
		this.logger.log(
			`Consumidor '${consumer.name}' registrado para '${consumer.pattern}'`
		);
	}

	/** Consumidores cujo padrao casa com o tipo do evento. */
	forEventType(type: string): EventConsumer[] {
		return this.consumers.filter((c) => matchesEventPattern(c.pattern, type));
	}

	all(): readonly EventConsumer[] {
		return this.consumers;
	}

	get size(): number {
		return this.consumers.length;
	}
}
