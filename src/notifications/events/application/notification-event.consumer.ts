import {
	Inject,
	Injectable,
	Logger,
	OnApplicationBootstrap,
} from '@nestjs/common';
import { DomainEvent } from 'src/events/domain/domain-event';
import { EventConsumer } from 'src/events/application/ports/event-consumer.port';
import { EventConsumerRegistry } from 'src/events/application/event-consumer.registry';
import { ThresholdEngineService } from 'src/thresholds/application/threshold-engine.service';
import { ThresholdDecision } from 'src/thresholds/domain/threshold.types';
import { NotificationsService } from './notifications.service';
import { toNotificationPayload } from './domain-event-notification.mapper';
import { buildTemplate } from '../channels/notification-templates';
import {
	NOTIFICATION_SUMMARY_PROVIDER,
	NotificationSummaryProvider,
	TransientSummaryError,
} from './ports/notification-summary.port';

/** Prefixo do dedupeKey. Deixa a origem legivel no doc persistido. */
export const NOTIFICATION_EVENT_DEDUPE_PREFIX = 'event';

/**
 * A ponta consumidora da TRA-136: e o que faz a maquinaria das fases 1 e 2
 * produzir efeito. Recebe o envelope do worker da fila e delega ao
 * NotificationsService, que ja sabe checar preferencia, montar template e
 * disparar canal.
 *
 * Ordem do handle, e o porque de cada passo estar onde esta:
 *
 *   1. MOTOR DE LIMIARES (fase 4). Decide se o evento merece virar
 *      notificacao. Evento continuo que nao cruzou banda, ou que ja estava
 *      cruzado, morre aqui — antes de qualquer I/O de canal.
 *   2. NOTIFICACAO DETERMINISTA. Sai com a copy de `buildTemplate`. Nao
 *      depende de IA nenhuma.
 *   3. ENRIQUECIMENTO (fase 5). So depois. Se o trackerr-ia estiver fora do
 *      ar, o usuario JA foi notificado.
 *
 * A ordem 2-antes-de-3 e a decisao central da fase 5. O inverso (resumir e
 * depois notificar) faria a lentidao ou a queda do trackerr-ia atrasar ou
 * engolir a notificacao — exatamente o que o requisito proibe. O custo e
 * conhecido e aceito: o e-mail sai sem o resumo, que fica visivel no centro
 * in-app. Levar o resumo para dentro do e-mail exigiria enriquecer antes do
 * envio, e ai o enriquecimento deixa de ser opcional.
 *
 * Falha TRANSITORIA no resumo sobe como excecao: a fila tenta de novo, e na
 * reentrega o `notify()` cai no dedupe (`event:<id>`) e devolve o doc que ja
 * existe, entao nao ha e-mail duplicado — so uma nova tentativa de resumo.
 * Esgotadas as tentativas, o envelope vai para a dead-letter com a
 * notificacao ja entregue.
 *
 * Idempotencia — requisito duro do contrato de EventConsumer — vem do
 * `dedupeKey: 'event:<event.id>'`. O `event.id` e gerado pelo PRODUTOR, nao
 * pelo transporte, entao a mesma ocorrencia de dominio carrega sempre a
 * mesma chave: reentrega da fila, retry apos falha parcial e reemissao pelo
 * futuro outbox caem todos no mesmo dedupe do NotificationsService.
 *
 * Limite conhecido: a janela de dedupe do NotificationsService e de 24h e a
 * checagem le o doc persistido, que so e gravado depois do envio. Um crash
 * entre "canal enviou" e "doc gravado" ainda pode duplicar. Fechar isso
 * exige escrita antes do envio (ou outbox), fora do escopo desta fase.
 *
 * `pattern: '**'` porque os tipos vivem em raizes diferentes
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
		private readonly registry: EventConsumerRegistry,
		private readonly thresholds: ThresholdEngineService,
		@Inject(NOTIFICATION_SUMMARY_PROVIDER)
		private readonly summaries: NotificationSummaryProvider
	) {}

	onApplicationBootstrap(): void {
		this.registry.register(this);
	}

	async handle(event: DomainEvent): Promise<void> {
		if (!event.subject) {
			// `subject` e o userId. Sem ele nao ha para quem notificar, e
			// repetir nao conserta.
			this.logger.warn(
				`Evento ${event.type} id=${event.id} sem subject (userId) — ignorado`
			);
			return;
		}

		const decision = await this.thresholds.decide(event);
		if (!decision.shouldNotify) {
			this.logger.debug(
				`Evento ${event.type} id=${event.id} barrado pelo motor de limiares (${decision.outcome}): ${decision.reason}`
			);
			return;
		}

		const payload = toNotificationPayload(event, decision.metrics);
		if (!payload) {
			this.logger.debug(
				`Evento ${event.type} id=${event.id} nao vira notificacao — ignorado`
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

		const notificationId = result.notificationId ?? result.dedupedFrom;
		if (notificationId) {
			await this.enrich(notificationId, event, payload, decision);
		}
	}

	/**
	 * Enriquecimento opcional. Nunca decide se a notificacao acontece — ela
	 * ja aconteceu quando este metodo roda.
	 */
	private async enrich(
		notificationId: string,
		event: DomainEvent,
		payload: Parameters<typeof buildTemplate>[0],
		decision: ThresholdDecision
	): Promise<void> {
		// Fato discreto nao tem evidencia calculada por regra; sem numeros
		// verificaveis o resumo so poderia inventar. Nao chamamos.
		if (decision.evidence.length === 0) return;

		// Reentrega da fila com resumo ja gravado: nao repete a chamada cara.
		const existing = await this.notifications.getAiSummary(notificationId);
		if (existing) return;

		const template = buildTemplate(payload);

		try {
			const summary = await this.summaries.summarize({
				userId: event.subject,
				notificationType: payload.type,
				ruleId: decision.ruleId,
				scope: decision.scope,
				deterministicTitle: template.title,
				deterministicBody: template.description,
				evidence: decision.evidence,
			});

			if (summary) {
				await this.notifications.attachAiSummary(notificationId, summary);
			}
		} catch (err) {
			if (err instanceof TransientSummaryError) {
				// Sobe de proposito: o retry da fila e o mecanismo de resiliencia
				// desenhado na fase 2. A notificacao ja saiu.
				this.logger.warn(
					`Resumo IA do evento ${event.id} falhou de forma transitoria (${err.message}) — a notificacao ja foi entregue, deixando a fila tentar de novo`
				);
				throw err;
			}
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(
				`Resumo IA do evento ${event.id} falhou: ${message} — notificacao mantida sem resumo`
			);
		}
	}
}
