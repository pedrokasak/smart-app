import { Logger } from '@nestjs/common';
import { EventConsumerRegistry } from 'src/events/application/event-consumer.registry';
import { createDomainEvent } from 'src/events/domain/domain-event.factory';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import { DomainEvent } from 'src/events/domain/domain-event';
import { NotificationEventConsumer } from './notification-event.consumer';
import { NotificationsService } from './notifications.service';
import { NotificationType } from '../domain/notification.types';

describe('NotificationEventConsumer', () => {
	let registry: EventConsumerRegistry;
	let notifications: { notify: jest.Mock };
	let consumer: NotificationEventConsumer;

	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

		registry = new EventConsumerRegistry();
		notifications = { notify: jest.fn().mockResolvedValue({ deliveries: [] }) };
		consumer = new NotificationEventConsumer(
			notifications as unknown as NotificationsService,
			registry
		);
	});

	afterEach(() => jest.restoreAllMocks());

	const dividendo = () =>
		createDomainEvent({
			type: DOMAIN_EVENT_TYPES.DividendReceived,
			subject: '68b0e2f0c1a2b3d4e5f60011',
			producer: 'server.assets.dividends',
			payload: { symbol: 'PETR4', amount: 12.34, currency: 'BRL' },
		});

	it('se registra no bootstrap para que o worker o encontre', () => {
		consumer.onApplicationBootstrap();

		expect(
			registry.forEventType(DOMAIN_EVENT_TYPES.DividendReceived)
		).toContain(consumer);
	});

	it('traduz o envelope e chama notify() com o userId do subject', async () => {
		const event = dividendo();

		await consumer.handle(event);

		expect(notifications.notify).toHaveBeenCalledWith({
			userId: event.subject,
			dedupeKey: `event:${event.id}`,
			payload: expect.objectContaining({
				type: NotificationType.DividendReceived,
				symbol: 'PETR4',
				amount: 12.34,
			}),
		});
	});

	/**
	 * O criterio de aceite: reentrega da fila nao pode virar duas
	 * notificacoes. A chave e o `event.id`, gerado pelo produtor — o
	 * NotificationsService reconhece a repeticao e devolve `dedupedFrom`.
	 */
	it('processar o mesmo event.id duas vezes gera uma notificacao so', async () => {
		const event = dividendo();
		const persistidos: string[] = [];

		notifications.notify.mockImplementation(
			async ({ dedupeKey }: { dedupeKey: string }) => {
				if (persistidos.includes(dedupeKey)) {
					return { dedupedFrom: 'doc-1', deliveries: [] };
				}
				persistidos.push(dedupeKey);
				return { notificationId: 'doc-1', deliveries: [] };
			}
		);

		await consumer.handle(event);
		await consumer.handle(event);

		expect(notifications.notify).toHaveBeenCalledTimes(2);
		expect(persistidos).toEqual([`event:${event.id}`]);
	});

	it('eventos diferentes com o mesmo conteudo nao se deduplicam', async () => {
		const chaves: string[] = [];
		notifications.notify.mockImplementation(
			async ({ dedupeKey }: { dedupeKey: string }) => {
				chaves.push(dedupeKey);
				return { deliveries: [] };
			}
		);

		await consumer.handle(dividendo());
		await consumer.handle(dividendo());

		expect(new Set(chaves).size).toBe(2);
	});

	it('ignora evento de tipo desconhecido sem lancar', async () => {
		const estranho = {
			...dividendo(),
			type: 'legado.evento.removido',
		} as DomainEvent;

		await expect(consumer.handle(estranho)).resolves.toBeUndefined();
		expect(notifications.notify).not.toHaveBeenCalled();
	});

	it('ignora envelope sem subject — nao ha para quem notificar', async () => {
		const semDono = { ...dividendo(), subject: '' } as DomainEvent;

		await consumer.handle(semDono);

		expect(notifications.notify).not.toHaveBeenCalled();
	});

	it('ignora payload malformado em vez de mandar para o retry', async () => {
		const quebrado = {
			...dividendo(),
			payload: { symbol: 'PETR4' },
		} as DomainEvent;

		await expect(consumer.handle(quebrado)).resolves.toBeUndefined();
		expect(notifications.notify).not.toHaveBeenCalled();
	});
});
