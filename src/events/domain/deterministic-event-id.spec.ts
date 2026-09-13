import { validateDomainEvent } from './domain-event.contract';
import { createDomainEvent } from './domain-event.factory';
import { deterministicEventId } from './deterministic-event-id';
import { DOMAIN_EVENT_TYPES } from './event-types';

describe('deterministicEventId', () => {
	it('mesmos componentes, mesmo id', () => {
		expect(deterministicEventId('user-1', 'expiring', 3)).toBe(
			deterministicEventId('user-1', 'expiring', 3)
		);
	});

	it('qualquer componente diferente muda o id', () => {
		const base = deterministicEventId('user-1', 'expiring', 3);
		expect(deterministicEventId('user-2', 'expiring', 3)).not.toBe(base);
		expect(deterministicEventId('user-1', 'expiring', 1)).not.toBe(base);
	});

	it('nao confunde componentes concatenados', () => {
		expect(deterministicEventId('ab', 'c')).not.toBe(
			deterministicEventId('a', 'bc')
		);
	});

	/** O envelope so passa pela guarda de contrato se o id for UUID valido. */
	it('produz um UUID aceito pelo contrato do envelope', () => {
		const event = createDomainEvent({
			id: deterministicEventId('user-1', 'expiring', 3),
			type: DOMAIN_EVENT_TYPES.SubscriptionExpiring,
			subject: 'user-1',
			producer: 'teste',
			payload: {
				planName: 'Pro',
				expiresAt: '2026-09-12T00:00:00.000Z',
				daysUntilExpiration: 3,
			},
		});

		expect(validateDomainEvent(event)).toEqual([]);
		expect(event.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
		);
	});
});
