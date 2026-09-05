import { DomainEvent } from 'src/events/domain/domain-event';
import {
	AiInsightHighPriorityPayload,
	AllocationBreachedPayload,
	DOMAIN_EVENT_TO_NOTIFICATION_TYPE,
	DOMAIN_EVENT_TYPES,
	DividendReceivedPayload,
	PortfolioScoreEvaluatedPayload,
	QuoteStalePayload,
	SubscriptionExpiringPayload,
	isDomainEventType,
} from 'src/events/domain/event-types';
import { NotificationPayload } from '../domain/notification.types';

/**
 * Traducao envelope -> payload de notificacao (TRA-136, fase 3).
 *
 * Funcao pura, sem Nest e sem Mongo, porque e regra: o mapa entre o
 * vocabulario do barramento e o das preferencias do usuario ja mora em
 * `DOMAIN_EVENT_TO_NOTIFICATION_TYPE`; aqui so se traduz o corpo.
 *
 * `metrics` vem do motor de limiares (TRA-136, fase 4) e carrega os
 * numeros que a DECISAO produziu e o evento cru nao tem — o caso e a queda
 * de score, em que `previousScore` e `dropPoints` so existem depois de
 * comparar com a leitura anterior. Continua opcional: os tipos discretos
 * ignoram o parametro.
 *
 * Defensiva de proposito. O payload chega de um job serializado no Redis,
 * que pode ter sido gravado por uma versao anterior do produtor. Campo
 * faltando devolve `null` — o consumidor loga e ignora. Lancar mandaria o
 * evento para o retry, e repetir um payload malformado da o mesmo
 * resultado cinco vezes.
 */
export function toNotificationPayload(
	event: DomainEvent,
	metrics: Record<string, number> = {}
): NotificationPayload | null {
	if (!isDomainEventType(event.type)) return null;

	const type = DOMAIN_EVENT_TO_NOTIFICATION_TYPE[event.type];
	const payload = (event.payload ?? {}) as Record<string, unknown>;

	switch (event.type) {
		case DOMAIN_EVENT_TYPES.DividendReceived: {
			const p = payload as unknown as DividendReceivedPayload;
			if (!isNonEmptyString(p.symbol) || !isFiniteNumber(p.amount)) return null;
			return {
				type,
				symbol: p.symbol,
				amount: p.amount,
				// Sem default aqui: o template ja assume BRL quando ausente.
				currency: p.currency,
				receivedAt: p.receivedAt ?? event.occurredAt,
			} as NotificationPayload;
		}

		case DOMAIN_EVENT_TYPES.AllocationBreached: {
			const p = payload as unknown as AllocationBreachedPayload;
			if (!isBucket(p.bucket)) return null;
			if (!isFiniteNumber(p.targetPct) || !isFiniteNumber(p.actualPct)) {
				return null;
			}
			return {
				type,
				bucket: p.bucket,
				targetPct: p.targetPct,
				actualPct: p.actualPct,
			} as NotificationPayload;
		}

		case DOMAIN_EVENT_TYPES.PortfolioScoreEvaluated: {
			const p = payload as unknown as PortfolioScoreEvaluatedPayload;
			if (!isFiniteNumber(p.score) || !isFiniteNumber(p.maxScore)) return null;
			// Sem os numeros da decisao nao ha o que contar: "seu score e 62"
			// nao e noticia; "caiu 14 pontos" e. Falta de `metrics` significa
			// que o evento chegou aqui sem passar pelo motor, e ai o certo e
			// nao notificar.
			if (
				!isFiniteNumber(metrics.previousScore) ||
				!isFiniteNumber(metrics.dropPoints)
			) {
				return null;
			}
			return {
				type,
				score: metrics.score ?? p.score,
				previousScore: metrics.previousScore,
				dropPoints: metrics.dropPoints,
				maxScore: p.maxScore,
			} as NotificationPayload;
		}

		case DOMAIN_EVENT_TYPES.AiInsightHighPriority: {
			const p = payload as unknown as AiInsightHighPriorityPayload;
			if (!isNonEmptyString(p.title) || !isNonEmptyString(p.summary)) {
				return null;
			}
			return {
				type,
				title: p.title,
				summary: p.summary,
				insightId: p.insightId,
			} as NotificationPayload;
		}

		case DOMAIN_EVENT_TYPES.QuoteStale: {
			const p = payload as unknown as QuoteStalePayload;
			if (
				!isNonEmptyString(p.symbol) ||
				!isFiniteNumber(p.minutesSinceLastQuote)
			) {
				return null;
			}
			return {
				type,
				symbol: p.symbol,
				minutesSinceLastQuote: p.minutesSinceLastQuote,
			} as NotificationPayload;
		}

		case DOMAIN_EVENT_TYPES.SubscriptionExpiring: {
			const p = payload as unknown as SubscriptionExpiringPayload;
			if (
				!isNonEmptyString(p.planName) ||
				!isNonEmptyString(p.expiresAt) ||
				!isFiniteNumber(p.daysUntilExpiration)
			) {
				return null;
			}
			return {
				type,
				planName: p.planName,
				expiresAt: p.expiresAt,
				daysUntilExpiration: p.daysUntilExpiration,
			} as NotificationPayload;
		}

		default:
			return null;
	}
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isBucket(
	value: unknown
): value is AllocationBreachedPayload['bucket'] {
	return (
		value === 'stocks' ||
		value === 'crypto' ||
		value === 'fiis' ||
		value === 'other'
	);
}
