import { Test } from '@nestjs/testing';
import { EventsModule } from './events.module';
import { EVENT_PUBLISHER } from './application/ports/event-publisher.port';
import { EVENT_SUBSCRIBER } from './application/ports/event-subscriber.port';
import { EVENT_QUEUE } from './application/ports/event-queue.port';
import {
	EVENT_QUEUE_CONFIG,
	EventQueueConfig,
} from './infrastructure/bullmq/queue.config';
import { InProcessEventBus } from './infrastructure/in-process-event-bus';
import { DisabledEventQueueAdapter } from './infrastructure/bullmq/disabled-event-queue.adapter';
import { EventQueueDispatcher } from './application/event-queue.dispatcher';
import { createDomainEvent } from './domain/domain-event.factory';
import { DOMAIN_EVENT_TYPES } from './domain/event-types';
import { EventPublisher } from './application/ports/event-publisher.port';
import { EventQueue } from './application/ports/event-queue.port';

/**
 * Prova a fiacao do modulo inteiro. Com NODE_ENV=test a fila fica desligada,
 * entao nenhuma conexao com Redis e aberta — o que se verifica aqui e o
 * grafo de providers e o caminho publish -> dispatcher -> porta da fila.
 */
describe('EventsModule (fiacao)', () => {
	let moduleRef: Awaited<ReturnType<typeof compilar>>;

	const compilar = async () =>
		Test.createTestingModule({ imports: [EventsModule] }).compile();

	beforeEach(async () => {
		moduleRef = await compilar();
		await moduleRef.init();
	});

	afterEach(async () => {
		await moduleRef.close();
	});

	it('resolve as tres portas', () => {
		expect(moduleRef.get(EVENT_PUBLISHER)).toBeDefined();
		expect(moduleRef.get(EVENT_SUBSCRIBER)).toBeDefined();
		expect(moduleRef.get(EVENT_QUEUE)).toBeDefined();
	});

	it('publisher e subscriber sao a mesma instancia do adaptador in-process', () => {
		const publisher = moduleRef.get(EVENT_PUBLISHER);
		expect(publisher).toBe(moduleRef.get(EVENT_SUBSCRIBER));
		expect(publisher).toBeInstanceOf(InProcessEventBus);
	});

	it('em teste a fila cai no null object, sem tocar em Redis', () => {
		const config = moduleRef.get<EventQueueConfig>(EVENT_QUEUE_CONFIG);
		expect(config.enabled).toBe(false);
		expect(moduleRef.get(EVENT_QUEUE)).toBeInstanceOf(
			DisabledEventQueueAdapter
		);
	});

	// O ponto da issue: publicar continua funcionando com a fila fora.
	it('publicar com a fila indisponivel nao lanca', async () => {
		const publisher = moduleRef.get<EventPublisher>(EVENT_PUBLISHER);

		await expect(
			publisher.publish(
				createDomainEvent({
					type: DOMAIN_EVENT_TYPES.SubscriptionExpiring,
					subject: 'user-1',
					producer: 'server.subscription',
					payload: {
						planName: 'PRO',
						expiresAt: new Date().toISOString(),
						daysUntilExpiration: 3,
					},
				})
			)
		).resolves.toBeUndefined();
	});

	it('o dispatcher assina o bus e encaminha o evento para a porta da fila', async () => {
		const publisher = moduleRef.get<EventPublisher>(EVENT_PUBLISHER);
		const queue = moduleRef.get<EventQueue>(EVENT_QUEUE);
		const enqueue = jest.spyOn(queue, 'enqueue');

		const event = createDomainEvent({
			type: DOMAIN_EVENT_TYPES.QuoteStale,
			subject: 'user-1',
			producer: 'server.market-data',
			payload: { symbol: 'VALE3', minutesSinceLastQuote: 90 },
		});
		await publisher.publish(event);

		expect(enqueue).toHaveBeenCalledWith(event);
		enqueue.mockRestore();
	});

	it('o dispatcher existe e e o unico ponto que liga bus e fila', () => {
		expect(moduleRef.get(EventQueueDispatcher)).toBeDefined();
	});
});
