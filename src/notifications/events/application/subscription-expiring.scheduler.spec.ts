import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SubscriptionExpiringScheduler } from './subscription-expiring.scheduler';
import { EVENT_PUBLISHER } from 'src/events/application/ports/event-publisher.port';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import { DomainEvent } from 'src/events/domain/domain-event';
import { validateDomainEvent } from 'src/events/domain/domain-event.contract';

/**
 * TRA-136: o cron parou de chamar NotificationsService.notify() e passou a
 * publicar `subscription.expiring`. Os casos continuam os mesmos — janelas
 * de alerta, fallback de nome do plano — so mudou o que se observa na
 * saida. A protecao contra disparo repetido migrou da `dedupeKey` de
 * dominio para o `event.id` deterministico.
 */

describe('SubscriptionExpiringScheduler', () => {
	let scheduler: SubscriptionExpiringScheduler;
	const findChain = { populate: jest.fn(), lean: jest.fn() };
	const UserSubModel = {
		find: jest.fn(() => findChain),
	};
	let publicados: DomainEvent[] = [];
	const publisher = {
		publish: jest.fn(async (event: DomainEvent) => {
			publicados.push(event);
		}),
	};

	beforeEach(async () => {
		jest.clearAllMocks();
		publicados = [];
		findChain.populate.mockReturnValue(findChain);
		findChain.lean.mockResolvedValue([]);

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				SubscriptionExpiringScheduler,
				{
					provide: getModelToken('UserSubscription'),
					useValue: UserSubModel,
				},
				{ provide: EVENT_PUBLISHER, useValue: publisher },
			],
		}).compile();

		scheduler = module.get(SubscriptionExpiringScheduler);
	});

	it('publica subscription.expiring para assinatura a 3 dias do fim', async () => {
		const now = new Date('2026-09-04T12:00:00Z');
		const expiresAt = new Date('2026-09-07T12:00:00Z'); // 3 dias
		const userId = new Types.ObjectId();
		findChain.lean.mockResolvedValue([
			{
				user: userId,
				currentPeriodEnd: expiresAt,
				plan: { name: 'Pro' },
				status: 'active',
				cancelAtPeriodEnd: false,
			},
		]);

		const dispatched = await scheduler.dispatch(now);

		expect(dispatched).toBe(1);
		expect(publicados).toHaveLength(1);
		expect(publicados[0]).toMatchObject({
			type: DOMAIN_EVENT_TYPES.SubscriptionExpiring,
			subject: userId.toString(),
			producer: 'server.subscription.expiring',
			payload: {
				planName: 'Pro',
				expiresAt: expiresAt.toISOString(),
				daysUntilExpiration: 3,
			},
		});
		// O envelope precisa sobreviver a guarda de contrato da fila.
		expect(validateDomainEvent(publicados[0])).toEqual([]);
	});

	/**
	 * Antes isso era garantido pela dedupeKey `expiring:3:2026-09-07`.
	 * Agora e o proprio id do evento que se repete — e o consumidor
	 * deduplica por id.
	 */
	it('rodar duas vezes no mesmo dia reemite o MESMO event.id', async () => {
		const now = new Date('2026-09-04T12:00:00Z');
		findChain.lean.mockResolvedValue([
			{
				user: new Types.ObjectId(),
				currentPeriodEnd: new Date('2026-09-07T12:00:00Z'),
				plan: { name: 'Pro' },
			},
		]);

		await scheduler.dispatch(now);
		await scheduler.dispatch(new Date('2026-09-04T18:00:00Z'));

		expect(publicados).toHaveLength(2);
		expect(publicados[0].id).toBe(publicados[1].id);
	});

	it('usuarios diferentes na mesma janela geram ids diferentes', async () => {
		const now = new Date('2026-09-04T12:00:00Z');
		findChain.lean.mockResolvedValue([
			{
				user: new Types.ObjectId(),
				currentPeriodEnd: new Date('2026-09-07T12:00:00Z'),
				plan: { name: 'Pro' },
			},
			{
				user: new Types.ObjectId(),
				currentPeriodEnd: new Date('2026-09-07T12:00:00Z'),
				plan: { name: 'Pro' },
			},
		]);

		await scheduler.dispatch(now);

		expect(publicados[0].id).not.toBe(publicados[1].id);
	});

	it('ignora assinaturas fora das janelas (ex: 5 dias)', async () => {
		const now = new Date('2026-09-04T12:00:00Z');
		findChain.lean.mockResolvedValue([
			{
				user: new Types.ObjectId(),
				currentPeriodEnd: new Date('2026-09-09T12:00:00Z'), // 5 dias
				plan: { name: 'Pro' },
			},
		]);
		const dispatched = await scheduler.dispatch(now);
		expect(dispatched).toBe(0);
		expect(publisher.publish).not.toHaveBeenCalled();
	});

	it('usa fallback de nome quando plano nao vem populado', async () => {
		const now = new Date('2026-09-04T12:00:00Z');
		findChain.lean.mockResolvedValue([
			{
				user: new Types.ObjectId(),
				currentPeriodEnd: new Date('2026-09-05T12:00:00Z'), // 1 dia
				plan: null,
			},
		]);
		await scheduler.dispatch(now);
		expect(publicados[0].payload).toMatchObject({ planName: 'Trakker' });
	});
});
