import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SubscriptionExpiringScheduler } from './subscription-expiring.scheduler';
import { NotificationsService } from './notifications.service';
import { NotificationType } from '../domain/notification.types';

describe('SubscriptionExpiringScheduler', () => {
	let scheduler: SubscriptionExpiringScheduler;
	const findChain = { populate: jest.fn(), lean: jest.fn() };
	const UserSubModel = {
		find: jest.fn(() => findChain),
	};
	const notifications = { notify: jest.fn() };

	beforeEach(async () => {
		jest.clearAllMocks();
		findChain.populate.mockReturnValue(findChain);
		findChain.lean.mockResolvedValue([]);

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				SubscriptionExpiringScheduler,
				{
					provide: getModelToken('UserSubscription'),
					useValue: UserSubModel,
				},
				{ provide: NotificationsService, useValue: notifications },
			],
		}).compile();

		scheduler = module.get(SubscriptionExpiringScheduler);
	});

	it('dispara notify() para assinatura a 3 dias do fim com dedupeKey correto', async () => {
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
		expect(notifications.notify).toHaveBeenCalledWith(
			expect.objectContaining({
				userId,
				dedupeKey: expect.stringMatching(/^expiring:3:2026-09-07$/),
				payload: expect.objectContaining({
					type: NotificationType.SubscriptionExpiring,
					planName: 'Pro',
					daysUntilExpiration: 3,
				}),
			})
		);
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
		expect(notifications.notify).not.toHaveBeenCalled();
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
		expect(notifications.notify).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({ planName: 'Trakker' }),
			})
		);
	});
});
