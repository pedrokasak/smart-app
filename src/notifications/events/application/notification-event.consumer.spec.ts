import { Logger } from '@nestjs/common';
import { EventConsumerRegistry } from 'src/events/application/event-consumer.registry';
import { createDomainEvent } from 'src/events/domain/domain-event.factory';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import { DomainEvent } from 'src/events/domain/domain-event';
import { NotificationEventConsumer } from './notification-event.consumer';
import { NotificationsService } from './notifications.service';
import { NotificationType } from '../domain/notification.types';
import { ThresholdEngineService } from 'src/thresholds/application/threshold-engine.service';
import {
	NotificationSummaryProvider,
	TransientSummaryError,
} from './ports/notification-summary.port';

/**
 * O motor de limiares tem teste proprio (`src/thresholds`). Aqui ele e um
 * duble que libera tudo — o que se prova neste arquivo e a traducao e o
 * dedupe, nao a decisao.
 */
const motorQueLibera = () =>
	({
		decide: jest.fn().mockResolvedValue({
			ruleId: null,
			scope: '',
			outcome: 'pass_through',
			reason: 'teste',
			shouldNotify: true,
			nextState: null,
			evidence: [],
			metrics: {},
		}),
	}) as unknown as ThresholdEngineService;

const semResumo = (): NotificationSummaryProvider => ({
	summarize: jest.fn().mockResolvedValue(null),
});

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
			registry,
			motorQueLibera(),
			semResumo()
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

/**
 * Fase 4 + 5 no ponto em que as duas se encontram: o motor decide, a
 * notificacao determinista sai, e so entao o trackerr-ia e chamado.
 */
describe('NotificationEventConsumer + motor de limiares e resumo IA', () => {
	const USER = '68b0e2f0c1a2b3d4e5f60011';

	const decisaoQueNotifica = {
		ruleId: 'allocation.drift',
		scope: 'crypto',
		outcome: 'notify',
		reason: 'borda de subida',
		shouldNotify: true,
		nextState: null,
		evidence: [
			{ label: 'Meta (%)', value: 30, source: 'allocation.targetPct' },
			{
				label: 'Exposicao real (%)',
				value: 35,
				source: 'allocation.actualPct',
			},
		],
		metrics: { targetPct: 30, actualPct: 35, deviationPp: 5 },
	};

	const evento = () =>
		createDomainEvent({
			type: DOMAIN_EVENT_TYPES.AllocationBreached,
			subject: USER,
			producer: 'test',
			payload: { bucket: 'crypto', targetPct: 30, actualPct: 35 },
		});

	const montar = (
		decisao: unknown,
		summarize: jest.Mock
	): {
		consumer: NotificationEventConsumer;
		notifications: {
			notify: jest.Mock;
			attachAiSummary: jest.Mock;
			getAiSummary: jest.Mock;
		};
	} => {
		const notifications = {
			notify: jest
				.fn()
				.mockResolvedValue({ notificationId: 'doc-1', deliveries: [] }),
			attachAiSummary: jest.fn().mockResolvedValue(undefined),
			getAiSummary: jest.fn().mockResolvedValue(null),
		};

		const consumer = new NotificationEventConsumer(
			notifications as unknown as NotificationsService,
			new EventConsumerRegistry(),
			{ decide: jest.fn().mockResolvedValue(decisao) } as any,
			{ summarize } as NotificationSummaryProvider
		);

		return { consumer, notifications };
	};

	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => jest.restoreAllMocks());

	it('decisao de nao notificar barra o evento antes de qualquer canal', async () => {
		const summarize = jest.fn();
		const { consumer, notifications } = montar(
			{
				...decisaoQueNotifica,
				outcome: 'suppressed_standing',
				shouldNotify: false,
			},
			summarize
		);

		await consumer.handle(evento());

		expect(notifications.notify).not.toHaveBeenCalled();
		expect(summarize).not.toHaveBeenCalled();
	});

	it('quando notifica, anexa o resumo do trackerr-ia ao doc', async () => {
		const summarize = jest.fn().mockResolvedValue('Sua cripto passou da meta.');
		const { consumer, notifications } = montar(decisaoQueNotifica, summarize);

		await consumer.handle(evento());

		expect(notifications.notify).toHaveBeenCalledTimes(1);
		expect(summarize).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: USER,
				ruleId: 'allocation.drift',
				scope: 'crypto',
				evidence: decisaoQueNotifica.evidence,
			})
		);
		expect(notifications.attachAiSummary).toHaveBeenCalledWith(
			'doc-1',
			'Sua cripto passou da meta.'
		);
	});

	/** O requisito central da fase 5: a IA e enriquecimento, nunca dependencia. */
	it('falha PERMANENTE do trackerr-ia: a notificacao sai mesmo assim', async () => {
		const summarize = jest
			.fn()
			.mockRejectedValue(new Error('payload invalido'));
		const { consumer, notifications } = montar(decisaoQueNotifica, summarize);

		await expect(consumer.handle(evento())).resolves.toBeUndefined();

		expect(notifications.notify).toHaveBeenCalledTimes(1);
		expect(notifications.attachAiSummary).not.toHaveBeenCalled();
	});

	it('falha TRANSITORIA: notifica primeiro e so entao propaga para o retry', async () => {
		const summarize = jest
			.fn()
			.mockRejectedValue(new TransientSummaryError('timeout of 8000ms'));
		const { consumer, notifications } = montar(decisaoQueNotifica, summarize);

		await expect(consumer.handle(evento())).rejects.toBeInstanceOf(
			TransientSummaryError
		);

		// A ordem e o ponto: o notify ja aconteceu quando a excecao subiu.
		expect(notifications.notify).toHaveBeenCalledTimes(1);
	});

	it('resumo vazio nao grava nada', async () => {
		const summarize = jest.fn().mockResolvedValue(null);
		const { consumer, notifications } = montar(decisaoQueNotifica, summarize);

		await consumer.handle(evento());

		expect(notifications.attachAiSummary).not.toHaveBeenCalled();
	});

	it('reentrega com resumo ja gravado nao chama o trackerr-ia de novo', async () => {
		const summarize = jest.fn();
		const { consumer, notifications } = montar(decisaoQueNotifica, summarize);
		notifications.notify.mockResolvedValue({
			dedupedFrom: 'doc-1',
			deliveries: [],
		});
		notifications.getAiSummary.mockResolvedValue('resumo anterior');

		await consumer.handle(evento());

		expect(summarize).not.toHaveBeenCalled();
	});

	it('evento discreto (sem evidencia) nao chama a IA', async () => {
		const summarize = jest.fn();
		const { consumer } = montar(
			{
				ruleId: null,
				scope: '',
				outcome: 'pass_through',
				reason: 'discreto',
				shouldNotify: true,
				nextState: null,
				evidence: [],
				metrics: {},
			},
			summarize
		);

		await consumer.handle(
			createDomainEvent({
				type: DOMAIN_EVENT_TYPES.DividendReceived,
				subject: USER,
				producer: 'test',
				payload: { symbol: 'PETR4', amount: 10 },
			})
		);

		expect(summarize).not.toHaveBeenCalled();
	});
});
