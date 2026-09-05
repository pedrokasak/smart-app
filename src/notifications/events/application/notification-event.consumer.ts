import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DomainEvent } from 'src/events/domain/domain-event';
import { EventConsumer } from 'src/events/application/ports/event-consumer.port';
import { EventConsumerRegistry } from 'src/events/application/event-consumer.registry';
import { NotificationsService } from './notifications.service';
import { toNotificationPayload } from './domain-event-notification.mapper';

/** Prefixo do dedupeKey. Deixa a origem legivel no doc persistido. */
export const NOTIFICATION_EVENT_DEDUPE_PREFIX = 'event';

/**
 * A ponta consumidora da TRA-136: e o que faz a maquinaria das fases 1 e 2
 * produzir efeito. Recebe o envelope do worker da fila e delega ao
 * NotificationsService, que ja sabe checar preferencia, montar template e
 * disparar canal.
 *
 * Idempotencia — requisito duro do contrato de EventConsumer — vem do
 * `dedupeKey: 'event:<event.id>'`. O `event.id` e gerado pelo PRODUTOR, nao
 * pelo transporte, entao a mesma ocorrencia de dominio carrega sempre a
 * mesma chave: reentrega da fila, retry apos falha parcial e reemissao pelo
 * futuro outbox caem todos no mesmo dedupe do NotificationsService.
 *
 * Isso substitui, para eventos, as dedupeKeys de dominio que os produtores
 * montavam a mao (ex.: `expiring:3:2026-09-07`). A responsabilidade de nao
 * repetir passa a ser do id do evento, que e um so para todos os tipos.
 *
 * Limite conhecido: a janela de dedupe do NotificationsService e de 24h e a
 * checagem le o doc persistido, que so e gravado depois do envio. Um crash
 * entre "canal enviou" e "doc gravado" ainda pode duplicar. Fechar isso
 * exige escrita antes do envio (ou outbox), fora do escopo desta fase.
 *
 * `pattern: '**'` porque os cinco tipos vivem em raizes diferentes
 * (`portfolio.`, `ai.`, `market.`, `subscription.`). O filtro real e o
 * mapeador: tipo que nao esta no registro de eventos de dominio devolve
 * null e o evento e ignorado.
 */
@Injectable()
export class NotificationEventConsumer
	implements EventConsumer, OnApplicationBootstrap
{
	readonly name = 'notifications';
	readonly pattern = '**';

	private readonly logger = new Logger(NotificationEventConsumer.name);

	constructor(
		private readonly notifications: NotificationsService,
		private readonly registry: EventConsumerRegistry
	) {}

	onApplicationBootstrap(): void {
		this.registry.register(this);
	}

	async handle(event: DomainEvent): Promise<void> {
		const payload = toNotificationPayload(event);
		if (!payload) {
			this.logger.debug(
				`Evento ${event.type} id=${event.id} nao vira notificacao — ignorado`
			);
			return;
		}

		if (!event.subject) {
			// `subject` e o userId. Sem ele nao ha para quem notificar, e
			// repetir nao conserta.
			this.logger.warn(
				`Evento ${event.type} id=${event.id} sem subject (userId) — ignorado`
			);
			return;
		}

		const result = await this.notifications.notify({
			userId: event.subject,
			payload,
			dedupeKey: `${NOTIFICATION_EVENT_DEDUPE_PREFIX}:${event.id}`,
		});

		if (result.dedupedFrom) {
			this.logger.debug(
				`Evento ${event.type} id=${event.id} ja notificado (doc=${result.dedupedFrom})`
			);
		}
	}
}
