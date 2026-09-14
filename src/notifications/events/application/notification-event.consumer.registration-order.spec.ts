import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventConsumerRegistry } from 'src/events/application/event-consumer.registry';
import { EventQueueWorker } from 'src/events/infrastructure/bullmq/event-queue.worker';
import { BullmqEventQueueAdapter } from 'src/events/infrastructure/bullmq/bullmq-event-queue.adapter';
import {
	EVENT_QUEUE_CONFIG,
	EventQueueConfig,
} from 'src/events/infrastructure/bullmq/queue.config';
import { ThresholdEngineService } from 'src/thresholds/application/threshold-engine.service';
import { NotificationEventConsumer } from './notification-event.consumer';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_SUMMARY_PROVIDER } from './ports/notification-summary.port';

/**
 * TRA-155. Em producao o worker subia logando `consumidores=0` e, na linha
 * seguinte, o consumidor 'notifications' se registrava. Nao era so log: o
 * `Worker` do BullMQ nasce com autorun e comeca a puxar jobs na hora, e
 * `EventQueueWorker.process` conclui em silencio o job que nao encontra
 * consumidor. Como o Redis persiste a fila, todo job pendente num deploy ou
 * restart era processado nessa janela — e a notificacao sumia.
 *
 * Este teste usa o ciclo de vida real do Nest, com o worker declarado ANTES
 * do consumidor (a ordem em que os modulos sobem em producao), e mede o
 * tamanho do registro no instante exato em que o `Worker` e construido.
 */

const registroNoMomentoDoWorker: number[] = [];
let registry: EventConsumerRegistry;

class FakeWorker extends EventEmitter {
	close = jest.fn().mockResolvedValue(undefined);
}
class FakeRedis extends EventEmitter {
	disconnect = jest.fn();
}

jest.mock('bullmq', () => ({
	...jest.requireActual('bullmq'),
	Worker: jest.fn().mockImplementation(() => {
		registroNoMomentoDoWorker.push(registry.size);
		return new FakeWorker();
	}),
}));

jest.mock('ioredis', () => {
	const Ctor = jest.fn().mockImplementation(() => new FakeRedis());
	return { __esModule: true, default: Ctor, Redis: Ctor };
});

describe('NotificationEventConsumer — ordem de registro no bootstrap', () => {
	beforeEach(() => {
		registroNoMomentoDoWorker.length = 0;
		jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => jest.restoreAllMocks());

	it('o consumidor ja esta registrado quando o Worker comeca a puxar jobs', async () => {
		const module = await Test.createTestingModule({
			providers: [
				{
					provide: EVENT_QUEUE_CONFIG,
					useValue: {
						enabled: true,
						workerEnabled: true,
						queueName: 'trackerr.events',
						connection: { host: 'localhost', port: 6379, db: 0 },
						concurrency: 20,
						attempts: 5,
						rateLimit: { max: 200, durationMs: 1000 },
					} as unknown as EventQueueConfig,
				},
				{ provide: BullmqEventQueueAdapter, useValue: {} },
				EventConsumerRegistry,
				// Worker antes do consumidor: e a ordem que expunha a janela.
				EventQueueWorker,
				NotificationEventConsumer,
				{ provide: NotificationsService, useValue: {} },
				{ provide: ThresholdEngineService, useValue: {} },
				{ provide: NOTIFICATION_SUMMARY_PROVIDER, useValue: {} },
			],
		}).compile();

		registry = module.get(EventConsumerRegistry);
		await module.init();

		expect(registroNoMomentoDoWorker).toEqual([1]);
		expect(registry.forEventType('portfolio.dividend.received')).toHaveLength(
			1
		);

		await module.close();
	});
});
