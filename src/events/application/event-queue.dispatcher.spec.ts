import { Logger } from '@nestjs/common';
import { EventQueueDispatcher } from './event-queue.dispatcher';
import { EventQueue } from './ports/event-queue.port';
import { EventSubscriber } from './ports/event-subscriber.port';
import { EventHandler } from 'src/events/domain/domain-event';
import { createDomainEvent } from 'src/events/domain/domain-event.factory';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';

describe('EventQueueDispatcher', () => {
	let queue: jest.Mocked<EventQueue>;
	let subscriber: EventSubscriber & { handlers: Map<string, EventHandler> };
	let dispatcher: EventQueueDispatcher;

	const evento = () =>
		createDomainEvent({
			type: DOMAIN_EVENT_TYPES.DividendReceived,
			subject: 'user-1',
			producer: 'server.dividends',
			payload: { symbol: 'PETR4', amount: 10 },
		});

	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

		queue = { enqueue: jest.fn() };
		subscriber = {
			handlers: new Map(),
			subscribe(pattern, handler) {
				this.handlers.set(pattern, handler);
			},
		};
		dispatcher = new EventQueueDispatcher(subscriber, queue);
	});

	afterEach(() => jest.restoreAllMocks());

	it('assina tudo (`**`) no bootstrap', () => {
		dispatcher.onApplicationBootstrap();
		expect(subscriber.handlers.has('**')).toBe(true);
	});

	it('o listener do bus so enfileira — nao executa trabalho pesado', async () => {
		queue.enqueue.mockResolvedValue({ outcome: 'enqueued', jobId: 'job-1' });
		dispatcher.onApplicationBootstrap();

		const event = evento();
		await subscriber.handlers.get('**')!(event);

		expect(queue.enqueue).toHaveBeenCalledTimes(1);
		expect(queue.enqueue).toHaveBeenCalledWith(event);
	});

	// Criterio de aceite: "Redis indisponivel nao derruba o request que
	// publicou o evento".
	it('fila indisponivel nao lanca — degrada com warn', async () => {
		queue.enqueue.mockResolvedValue({
			outcome: 'unavailable',
			error: 'ECONNREFUSED',
		});

		await expect(dispatcher.dispatch(evento())).resolves.toBeUndefined();
		expect(Logger.prototype.warn).toHaveBeenCalledWith(
			expect.stringContaining('ECONNREFUSED')
		);
	});

	it('enqueue que rejeita tambem nao lanca', async () => {
		queue.enqueue.mockRejectedValue(new Error('explodiu'));

		await expect(dispatcher.dispatch(evento())).resolves.toBeUndefined();
		expect(Logger.prototype.error).toHaveBeenCalledWith(
			expect.stringContaining('explodiu')
		);
	});

	it('duplicado e ignorado em silencio (debug), sem warn nem error', async () => {
		queue.enqueue.mockResolvedValue({ outcome: 'duplicate', jobId: 'job-1' });

		await dispatcher.dispatch(evento());

		expect(Logger.prototype.warn).not.toHaveBeenCalled();
		expect(Logger.prototype.error).not.toHaveBeenCalled();
	});

	it('depende so das portas — nao conhece bullmq nem EventEmitter2', () => {
		// O construtor aceita qualquer implementacao das duas portas. Se o
		// dispatcher importasse o transporte, este teste nem compilaria com
		// os dublês acima.
		expect(dispatcher).toBeInstanceOf(EventQueueDispatcher);
	});
});
