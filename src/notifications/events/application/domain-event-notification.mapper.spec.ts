import { createDomainEvent } from 'src/events/domain/domain-event.factory';
import {
	DOMAIN_EVENT_TO_NOTIFICATION_TYPE,
	DOMAIN_EVENT_TYPES,
	DOMAIN_EVENT_TYPE_LIST,
} from 'src/events/domain/event-types';
import { DomainEvent } from 'src/events/domain/domain-event';
import { toNotificationPayload } from './domain-event-notification.mapper';
import { NotificationType } from '../domain/notification.types';

describe('toNotificationPayload', () => {
	const envelope = <T>(type: string, payload: T): DomainEvent =>
		({
			id: 'evt-1',
			type,
			version: 1,
			occurredAt: '2026-09-05T12:00:00.000Z',
			producer: 'teste',
			subject: 'user-1',
			payload,
		}) as DomainEvent;

	const validos: Record<string, unknown> = {
		[DOMAIN_EVENT_TYPES.DividendReceived]: { symbol: 'PETR4', amount: 10 },
		[DOMAIN_EVENT_TYPES.AllocationBreached]: {
			bucket: 'crypto',
			targetPct: 10,
			actualPct: 22.5,
		},
		[DOMAIN_EVENT_TYPES.PortfolioScoreEvaluated]: { score: 66, maxScore: 100 },
		[DOMAIN_EVENT_TYPES.AiInsightHighPriority]: {
			title: 'Concentracao alta',
			summary: 'Cripto passou de 20% da carteira.',
		},
		[DOMAIN_EVENT_TYPES.QuoteStale]: {
			symbol: 'BBAS3',
			minutesSinceLastQuote: 90,
		},
		[DOMAIN_EVENT_TYPES.SubscriptionExpiring]: {
			planName: 'Pro',
			expiresAt: '2026-09-12T00:00:00.000Z',
			daysUntilExpiration: 7,
		},
	};

	/**
	 * O mapa evento -> notificacao existe justamente para nao deixar um tipo
	 * novo passar sem tradutor. Se alguem adicionar um evento em
	 * `event-types.ts` e esquecer deste arquivo, este teste quebra.
	 */
	/**
	 * `metrics` so existe para os tipos continuos: sao os numeros que a
	 * decisao do motor de limiares produz (TRA-136, fase 4) e que o evento
	 * cru nao carrega.
	 */
	const metricas: Record<string, Record<string, number>> = {
		[DOMAIN_EVENT_TYPES.PortfolioScoreEvaluated]: {
			score: 66,
			previousScore: 80,
			dropPoints: 14,
			maxScore: 100,
		},
	};

	it('traduz todos os tipos declarados no registro de eventos', () => {
		for (const type of DOMAIN_EVENT_TYPE_LIST) {
			const payload = toNotificationPayload(
				envelope(type, validos[type]),
				metricas[type]
			);
			expect(payload).not.toBeNull();
			expect(payload?.type).toBe(DOMAIN_EVENT_TO_NOTIFICATION_TYPE[type]);
		}
	});

	it('cai no occurredAt quando o dividendo nao traz receivedAt', () => {
		const event = createDomainEvent({
			type: DOMAIN_EVENT_TYPES.DividendReceived,
			subject: 'user-1',
			producer: 'server.assets.dividends',
			payload: { symbol: 'PETR4', amount: 3 },
			occurredAt: '2026-08-01T00:00:00.000Z',
		});

		const payload = toNotificationPayload(event);

		expect(payload).toMatchObject({
			type: NotificationType.DividendReceived,
			receivedAt: '2026-08-01T00:00:00.000Z',
		});
	});

	it('devolve null para tipo fora do registro', () => {
		expect(
			toNotificationPayload(envelope('legado.evento.removido', {}))
		).toBeNull();
	});

	it.each([
		[DOMAIN_EVENT_TYPES.DividendReceived, { symbol: 'PETR4' }],
		[DOMAIN_EVENT_TYPES.AllocationBreached, { bucket: 'ouro', targetPct: 1 }],
		[DOMAIN_EVENT_TYPES.AiInsightHighPriority, { title: '   ' }],
		[DOMAIN_EVENT_TYPES.QuoteStale, { symbol: 'BBAS3' }],
		[DOMAIN_EVENT_TYPES.SubscriptionExpiring, { planName: 'Pro' }],
	])('devolve null para payload incompleto de %s', (type, payload) => {
		expect(toNotificationPayload(envelope(type, payload))).toBeNull();
	});

	it('devolve null quando o payload nem existe', () => {
		expect(
			toNotificationPayload(
				envelope(DOMAIN_EVENT_TYPES.DividendReceived, undefined)
			)
		).toBeNull();
	});
});
