import { EventEmitter2 } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { InProcessEventBus } from 'src/events/infrastructure/in-process-event-bus';
import { EventQueueDispatcher } from 'src/events/application/event-queue.dispatcher';
import { EventConsumerRegistry } from 'src/events/application/event-consumer.registry';
import { EventQueueWorker } from 'src/events/infrastructure/bullmq/event-queue.worker';
import { BullmqEventQueueAdapter } from 'src/events/infrastructure/bullmq/bullmq-event-queue.adapter';
import { loadEventQueueConfig } from 'src/events/infrastructure/bullmq/queue.config';
import {
	EnqueueResult,
	EventQueue,
} from 'src/events/application/ports/event-queue.port';
import { DomainEvent } from 'src/events/domain/domain-event';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import { DividendReceivedProducer } from 'src/assets/events/dividend-received.producer';
import { NotificationEventConsumer } from 'src/notifications/events/application/notification-event.consumer';
import { NotificationsService } from 'src/notifications/events/application/notifications.service';
import { NotificationType } from 'src/notifications/events/domain/notification.types';

/**
 * Prova ponta a ponta da TRA-136: produtor -> barramento -> fila -> worker
 * -> consumidor -> NotificationsService.notify().
 *
 * Cada peca e a real; so o Redis e o Mongo sao dublados. E o unico teste
 * que responde "a maquinaria das fases 1 e 2 faz alguma coisa acontecer?".
 *
 * A fila em memoria replica o contrato do adaptador BullMQ nos dois pontos
 * que importam para o fluxo: o jobId e o `event.id` (deduplicacao nativa) e
 * o payload atravessa serializacao JSON, como atravessaria no Redis.
 */
class FilaEmMemoria implements EventQueue {
	readonly enfileirados: string[] = [];
	entregar: (job: { id: string; data: unknown }) => Promise<void> = async () =>
		undefined;

	async enqueue<T>(event: DomainEvent<T>): Promise<EnqueueResult> {
		if (this.enfileirados.includes(event.id)) {
			return { outcome: 'duplicate', jobId: event.id };
		}
		this.enfileirados.push(event.id);
		await this.entregar({
			id: event.id,
			data: JSON.parse(JSON.stringify(event)),
		});
		return { outcome: 'enqueued', jobId: event.id };
	}
}

describe('produtor -> barramento -> fila -> notificacao (TRA-136)', () => {
	const userId = new Types.ObjectId();
	const portfolioId = new Types.ObjectId();

	let emitter: EventEmitter2;
	let bus: InProcessEventBus;
	let fila: FilaEmMemoria;
	let registry: EventConsumerRegistry;
	let notificados: { userId: unknown; dedupeKey?: string }[];
	let notifications: { notify: jest.Mock };
	let producer: DividendReceivedProducer;

	const chain = (value: unknown) => ({
		select: jest.fn().mockReturnValue({
			lean: jest.fn().mockResolvedValue(value),
		}),
	});

	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

		emitter = new EventEmitter2({
			wildcard: true,
			delimiter: '.',
			maxListeners: 50,
		});
		bus = new InProcessEventBus(emitter);

		fila = new FilaEmMemoria();
		registry = new EventConsumerRegistry();

		const worker = new EventQueueWorker(
			loadEventQueueConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv),
			{ sendToDeadLetter: jest.fn() } as unknown as BullmqEventQueueAdapter,
			registry
		);
		fila.entregar = (job) => worker.process(job);

		// A costura real da fase 2: assina '**' no barramento e so enfileira.
		new EventQueueDispatcher(bus, fila).onApplicationBootstrap();

		// Dedupe do NotificationsService, simplificado: (user, dedupeKey).
		notificados = [];
		notifications = {
			notify: jest.fn(async (input: any) => {
				const chave = `${String(input.userId)}|${input.dedupeKey}`;
				if (
					notificados.some(
						(n) => `${String(n.userId)}|${n.dedupeKey}` === chave
					)
				) {
					return { dedupedFrom: 'doc-anterior', deliveries: [] };
				}
				notificados.push(input);
				return { notificationId: `doc-${notificados.length}`, deliveries: [] };
			}),
		};

		new NotificationEventConsumer(
			notifications as unknown as NotificationsService,
			registry
		).onApplicationBootstrap();

		producer = new DividendReceivedProducer(
			bus,
			{
				findById: jest.fn(() => chain({ symbol: 'PETR4', portfolioId })),
			} as any,
			{ findById: jest.fn(() => chain({ userId })) } as any
		);
	});

	afterEach(() => {
		emitter.removeAllListeners();
		jest.restoreAllMocks();
	});

	it('um provento novo chega ate o notify() com o payload traduzido', async () => {
		await producer.publishForAsset('asset-1', [
			{ date: new Date('2026-08-20T00:00:00Z'), value: 42.5 },
		]);

		expect(fila.enfileirados).toHaveLength(1);
		expect(notifications.notify).toHaveBeenCalledTimes(1);
		expect(notifications.notify).toHaveBeenCalledWith({
			userId: userId.toString(),
			dedupeKey: `event:${fila.enfileirados[0]}`,
			payload: {
				type: NotificationType.DividendReceived,
				symbol: 'PETR4',
				amount: 42.5,
				currency: 'BRL',
				receivedAt: '2026-08-20T00:00:00.000Z',
			},
		});
	});

	it('o jobId da fila e o event.id gerado pelo produtor, nao pelo transporte', async () => {
		await producer.publishForAsset('asset-1', [
			{ date: new Date('2026-08-20T00:00:00Z'), value: 1 },
		]);

		const dedupeKey = notifications.notify.mock.calls[0][0].dedupeKey;
		expect(dedupeKey).toBe(`event:${fila.enfileirados[0]}`);
	});

	it('reentrega do mesmo evento nao gera segunda notificacao', async () => {
		await producer.publishForAsset('asset-1', [
			{ date: new Date('2026-08-20T00:00:00Z'), value: 1 },
		]);

		const enfileirado = fila.enfileirados[0];
		const consumidor = registry.forEventType(
			DOMAIN_EVENT_TYPES.DividendReceived
		)[0];

		// Simula o retry do worker sobre o MESMO envelope.
		await consumidor.handle({
			id: enfileirado,
			type: DOMAIN_EVENT_TYPES.DividendReceived,
			version: 1,
			occurredAt: '2026-08-20T00:00:00.000Z',
			producer: 'server.assets.dividends',
			subject: userId.toString(),
			payload: { symbol: 'PETR4', amount: 1, currency: 'BRL' },
		});

		expect(notifications.notify).toHaveBeenCalledTimes(2);
		expect(notificados).toHaveLength(1);
	});

	/**
	 * Criterio de aceite: fila fora do ar nao derruba quem produziu. O
	 * dividendo ja foi gravado; o que se perde e a entrega assincrona.
	 */
	it('fila indisponivel nao propaga erro para o produtor', async () => {
		jest
			.spyOn(fila, 'enqueue')
			.mockResolvedValue({ outcome: 'unavailable', error: 'ECONNREFUSED' });

		await expect(
			producer.publishForAsset('asset-1', [
				{ date: new Date('2026-08-20T00:00:00Z'), value: 1 },
			])
		).resolves.toBeUndefined();
		expect(notifications.notify).not.toHaveBeenCalled();
	});

	it('assinante que explode nao derruba a publicacao', async () => {
		bus.subscribe('**', () => {
			throw new Error('assinante quebrado');
		});

		await expect(
			producer.publishForAsset('asset-1', [
				{ date: new Date('2026-08-20T00:00:00Z'), value: 1 },
			])
		).resolves.toBeUndefined();
	});
});
