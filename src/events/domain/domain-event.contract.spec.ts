import { createDomainEvent } from './domain-event.factory';
import {
	assertDomainEvent,
	InvalidDomainEventError,
	isDomainEvent,
	validateDomainEvent,
} from './domain-event.contract';
import {
	DOMAIN_EVENT_TO_NOTIFICATION_TYPE,
	DOMAIN_EVENT_TYPE_LIST,
	DOMAIN_EVENT_TYPES,
	DOMAIN_EVENT_VERSIONS,
	isDomainEventType,
} from './event-types';

describe('contrato do envelope DomainEvent', () => {
	const valid = () =>
		createDomainEvent({
			type: DOMAIN_EVENT_TYPES.DividendReceived,
			subject: '507f1f77bcf86cd799439011',
			producer: 'server.dividends',
			payload: { symbol: 'PETR4', amount: 12.34 },
		});

	it('o factory preenche id (UUID) e occurredAt (ISO-8601)', () => {
		const event = valid();
		expect(validateDomainEvent(event)).toEqual([]);
		expect(isDomainEvent(event)).toBe(true);
		expect(new Date(event.occurredAt).toISOString()).toBe(event.occurredAt);
	});

	it('gera um id diferente por evento — a chave de idempotencia', () => {
		expect(valid().id).not.toBe(valid().id);
	});

	it('o id vem do produtor, nao do transporte: pode ser reaproveitado', () => {
		const id = valid().id;
		const reemitido = createDomainEvent({
			id,
			type: DOMAIN_EVENT_TYPES.DividendReceived,
			subject: 'u1',
			producer: 'server.outbox-relay',
			payload: { symbol: 'PETR4', amount: 1 },
		});
		expect(reemitido.id).toBe(id);
	});

	it('usa a versao registrada do tipo quando nao informada', () => {
		expect(valid().version).toBe(
			DOMAIN_EVENT_VERSIONS[DOMAIN_EVENT_TYPES.DividendReceived]
		);
	});

	it('aceita occurredAt explicito (fato anterior a publicacao)', () => {
		const ocorrido = new Date('2026-01-02T03:04:05.000Z');
		const event = createDomainEvent({
			type: DOMAIN_EVENT_TYPES.QuoteStale,
			subject: 'u1',
			producer: 'server.market-data',
			payload: { symbol: 'VALE3', minutesSinceLastQuote: 90 },
			occurredAt: ocorrido,
		});
		expect(event.occurredAt).toBe('2026-01-02T03:04:05.000Z');
	});

	it('omite correlationId/causationId quando nao informados', () => {
		const event = valid();
		expect('correlationId' in event).toBe(false);
		expect('causationId' in event).toBe(false);
	});

	it('propaga correlationId e causationId quando informados', () => {
		const event = createDomainEvent({
			type: DOMAIN_EVENT_TYPES.AiInsightHighPriority,
			subject: 'u1',
			producer: 'server.ai',
			payload: { title: 't', summary: 's' },
			correlationId: 'corr-1',
			causationId: 'cause-1',
		});
		expect(event.correlationId).toBe('corr-1');
		expect(event.causationId).toBe('cause-1');
	});

	it('sobrevive ao round-trip de serializacao — o envelope e portatil', () => {
		const event = valid();
		const rehidratado = JSON.parse(JSON.stringify(event));
		expect(rehidratado).toEqual(event);
		expect(isDomainEvent(rehidratado)).toBe(true);
	});

	describe('violacoes', () => {
		it.each([
			['id ausente', { id: undefined }, 'id'],
			['id nao-UUID', { id: 'abc' }, 'id'],
			['type vazio', { type: '' }, 'type'],
			['version zero', { version: 0 }, 'version'],
			['version fracionaria', { version: 1.5 }, 'version'],
			[
				'occurredAt sem timezone',
				{ occurredAt: '2026-01-02 03:04' },
				'occurredAt',
			],
			['producer vazio', { producer: '' }, 'producer'],
			['subject vazio', { subject: '' }, 'subject'],
			['correlationId nao-string', { correlationId: 7 }, 'correlationId'],
		])('rejeita %s', (_nome, patch, campo) => {
			const violacoes = validateDomainEvent({ ...valid(), ...patch });
			expect(violacoes.join(' ')).toContain(campo);
		});

		it('exige payload presente', () => {
			const { payload: _descartado, ...semPayload } = valid();
			expect(validateDomainEvent(semPayload)).toContain(
				'payload e obrigatorio'
			);
		});

		it.each([[null], [undefined], ['string'], [42], [[]]])(
			'rejeita envelope que nao e objeto: %p',
			(valor) => {
				expect(isDomainEvent(valor)).toBe(false);
			}
		);

		it('assertDomainEvent lanca InvalidDomainEventError com as violacoes', () => {
			expect(() => assertDomainEvent({ id: 'nope' })).toThrow(
				InvalidDomainEventError
			);
			try {
				assertDomainEvent({ id: 'nope' });
			} catch (err) {
				expect(
					(err as InvalidDomainEventError).violations.length
				).toBeGreaterThan(1);
			}
		});
	});
});

describe('registro de tipos de evento', () => {
	it('cobre os cinco eventos de dominio da TRA-136', () => {
		expect(DOMAIN_EVENT_TYPE_LIST).toHaveLength(5);
		expect(DOMAIN_EVENT_TYPE_LIST).toEqual(
			expect.arrayContaining([
				'portfolio.dividend.received',
				'portfolio.allocation.breached',
				'ai.insight.high_priority',
				'market.quote.stale',
				'subscription.expiring',
			])
		);
	});

	it('nao tem tipo duplicado', () => {
		expect(new Set(DOMAIN_EVENT_TYPE_LIST).size).toBe(
			DOMAIN_EVENT_TYPE_LIST.length
		);
	});

	it('todo tipo tem versao e mapeamento para NotificationType', () => {
		for (const type of DOMAIN_EVENT_TYPE_LIST) {
			expect(DOMAIN_EVENT_VERSIONS[type]).toBeGreaterThanOrEqual(1);
			expect(DOMAIN_EVENT_TO_NOTIFICATION_TYPE[type]).toBeDefined();
		}
	});

	it('isDomainEventType reconhece so o que esta registrado', () => {
		expect(isDomainEventType('portfolio.dividend.received')).toBe(true);
		expect(isDomainEventType('portfolio.dividend.paid')).toBe(false);
	});
});
