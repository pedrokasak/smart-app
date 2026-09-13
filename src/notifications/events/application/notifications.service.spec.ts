import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotificationsService } from './notifications.service';
import {
	NOTIFICATION_CHANNELS,
	NotificationChannel,
} from '../channels/notification-channel.port';
import {
	NotificationChannelName,
	NotificationDeliveryStatus,
	NotificationType,
} from '../domain/notification.types';

function fakeUser(overrides: Record<string, unknown> = {}) {
	return {
		_id: new Types.ObjectId(),
		email: 'user@example.com',
		firstName: 'Test',
		notificationPreferences: {},
		...overrides,
	};
}

function makeChannel(
	name: NotificationChannelName,
	send: jest.Mock
): NotificationChannel {
	return { name: () => name, send };
}

describe('NotificationsService', () => {
	const NotificationModelMock = {
		create: jest.fn(),
		findOne: jest.fn(),
		find: jest.fn(),
	};
	const UserModelMock = {
		findById: jest.fn(),
	};

	let service: NotificationsService;
	let emailSend: jest.Mock;
	let pushSend: jest.Mock;

	beforeEach(async () => {
		jest.clearAllMocks();
		emailSend = jest.fn().mockResolvedValue({
			channel: NotificationChannelName.Email,
			success: true,
		});
		pushSend = jest.fn().mockResolvedValue({
			channel: NotificationChannelName.Push,
			success: true,
		});

		NotificationModelMock.create.mockImplementation(async (doc) => ({
			_id: new Types.ObjectId(),
			...doc,
		}));
		NotificationModelMock.findOne.mockReturnValue({
			sort: () => ({ lean: () => Promise.resolve(null) }),
		});

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				NotificationsService,
				{
					provide: getModelToken('Notification'),
					useValue: NotificationModelMock,
				},
				{ provide: getModelToken('User'), useValue: UserModelMock },
				{
					provide: NOTIFICATION_CHANNELS,
					useValue: [
						makeChannel(NotificationChannelName.Email, emailSend),
						makeChannel(NotificationChannelName.Push, pushSend),
					],
				},
			],
		}).compile();

		service = module.get(NotificationsService);
	});

	it('dispara em todos os canais quando preferencia esta ausente e default e true', async () => {
		const user = fakeUser();
		UserModelMock.findById.mockReturnValue({
			lean: () => Promise.resolve(user),
		});

		const result = await service.notify({
			userId: user._id,
			payload: {
				type: NotificationType.SubscriptionExpiring,
				planName: 'Pro',
				expiresAt: new Date().toISOString(),
				daysUntilExpiration: 3,
			},
		});

		expect(emailSend).toHaveBeenCalledTimes(1);
		expect(pushSend).toHaveBeenCalledTimes(1);
		expect(result.deliveries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					channel: NotificationChannelName.Email,
					status: NotificationDeliveryStatus.Sent,
				}),
				expect.objectContaining({
					channel: NotificationChannelName.Push,
					status: NotificationDeliveryStatus.Sent,
				}),
			])
		);
		expect(NotificationModelMock.create).toHaveBeenCalledTimes(1);
	});

	it('pula canal quando usuario desativou a preferencia', async () => {
		const user = fakeUser({
			notificationPreferences: {
				email: { subscriptionExpiring: false },
				push: { subscriptionExpiring: false },
			},
		});
		UserModelMock.findById.mockReturnValue({
			lean: () => Promise.resolve(user),
		});

		const result = await service.notify({
			userId: user._id,
			payload: {
				type: NotificationType.SubscriptionExpiring,
				planName: 'Pro',
				expiresAt: new Date().toISOString(),
				daysUntilExpiration: 3,
			},
		});

		expect(emailSend).not.toHaveBeenCalled();
		expect(pushSend).not.toHaveBeenCalled();
		expect(result.deliveries.every((d) => d.status === 'skipped')).toBe(true);
	});

	it('respeita default false (dividendReceived) quando pref ausente', async () => {
		const user = fakeUser();
		UserModelMock.findById.mockReturnValue({
			lean: () => Promise.resolve(user),
		});

		await service.notify({
			userId: user._id,
			payload: {
				type: NotificationType.DividendReceived,
				symbol: 'PETR4',
				amount: 12.34,
			},
		});

		expect(emailSend).not.toHaveBeenCalled();
		expect(pushSend).not.toHaveBeenCalled();
	});

	it('deduplica quando dedupeKey ja existe na janela', async () => {
		const user = fakeUser();
		UserModelMock.findById.mockReturnValue({
			lean: () => Promise.resolve(user),
		});
		const previous = {
			_id: new Types.ObjectId(),
			deliveries: [
				{
					channel: NotificationChannelName.Email,
					status: NotificationDeliveryStatus.Sent,
				},
			],
		};
		NotificationModelMock.findOne.mockReturnValue({
			sort: () => ({ lean: () => Promise.resolve(previous) }),
		});

		const result = await service.notify({
			userId: user._id,
			payload: {
				type: NotificationType.SubscriptionExpiring,
				planName: 'Pro',
				expiresAt: new Date().toISOString(),
				daysUntilExpiration: 3,
			},
			dedupeKey: 'expiring:3:2026-09-04',
		});

		expect(emailSend).not.toHaveBeenCalled();
		expect(pushSend).not.toHaveBeenCalled();
		expect(NotificationModelMock.create).not.toHaveBeenCalled();
		expect(result.dedupedFrom).toBe(previous._id.toString());
	});

	it('marca delivery como Failed quando canal joga', async () => {
		const user = fakeUser();
		UserModelMock.findById.mockReturnValue({
			lean: () => Promise.resolve(user),
		});
		emailSend.mockRejectedValueOnce(new Error('resend down'));

		const result = await service.notify({
			userId: user._id,
			payload: {
				type: NotificationType.SubscriptionExpiring,
				planName: 'Pro',
				expiresAt: new Date().toISOString(),
				daysUntilExpiration: 3,
			},
		});

		const email = result.deliveries.find(
			(d) => d.channel === NotificationChannelName.Email
		);
		expect(email?.status).toBe(NotificationDeliveryStatus.Failed);
		expect(email?.error).toBe('resend down');
	});

	it('nao dispara quando usuario nao existe', async () => {
		UserModelMock.findById.mockReturnValue({
			lean: () => Promise.resolve(null),
		});
		const result = await service.notify({
			userId: new Types.ObjectId(),
			payload: {
				type: NotificationType.SubscriptionExpiring,
				planName: 'Pro',
				expiresAt: new Date().toISOString(),
				daysUntilExpiration: 1,
			},
		});
		expect(result.deliveries).toHaveLength(0);
		expect(NotificationModelMock.create).not.toHaveBeenCalled();
	});

	/**
	 * TRA-136, fase 7: `allocationBreached` e `portfolioScoreDropped`
	 * passaram a vir LIGADOS por padrao (o motor de limiares removeu o risco
	 * de spam que os mantinha desligados).
	 *
	 * O que estes testes provam nao e a virada em si — e que ela nao passa
	 * por cima de ninguem. Campo AUSENTE cai no default novo; `false`
	 * GRAVADO pelo usuario continua valendo. Os dois casos precisam ser
	 * distinguiveis, e sao: o schema usa `default: undefined` por evento,
	 * entao um doc sem a preferencia nao ganha `false` no banco, e
	 * `userAllows` so consulta o default quando `typeof value !== 'boolean'`.
	 */
	describe('virada dos defaults ligados (TRA-136, fase 7)', () => {
		const LIGADOS_POR_PADRAO = [
			NotificationType.AllocationBreached,
			NotificationType.PortfolioScoreDropped,
		];

		it.each(LIGADOS_POR_PADRAO)(
			'%s com preferencia AUSENTE usa o default novo (ligado)',
			(type) => {
				const user = fakeUser({ notificationPreferences: {} }) as never;

				expect(
					service.userAllows(user, type, NotificationChannelName.Email)
				).toBe(true);
				expect(
					service.userAllows(user, type, NotificationChannelName.Push)
				).toBe(true);
			}
		);

		it.each(LIGADOS_POR_PADRAO)(
			'%s com `false` explicito continua desligado apesar do default novo',
			(type) => {
				const user = fakeUser({
					notificationPreferences: {
						email: { [type]: false },
						push: { [type]: false },
					},
				}) as never;

				expect(
					service.userAllows(user, type, NotificationChannelName.Email)
				).toBe(false);
				expect(
					service.userAllows(user, type, NotificationChannelName.Push)
				).toBe(false);
			}
		);

		it('o opt-out explicito impede o envio de ponta a ponta', async () => {
			const user = fakeUser({
				notificationPreferences: {
					email: { allocationBreached: false },
					push: { allocationBreached: false },
				},
			});
			UserModelMock.findById.mockReturnValue({
				lean: () => Promise.resolve(user),
			});

			const result = await service.notify({
				userId: user._id,
				payload: {
					type: NotificationType.AllocationBreached,
					bucket: 'crypto',
					targetPct: 10,
					actualPct: 21,
				},
			});

			expect(emailSend).not.toHaveBeenCalled();
			expect(pushSend).not.toHaveBeenCalled();
			expect(
				result.deliveries.every(
					(d) => d.status === NotificationDeliveryStatus.Skipped
				)
			).toBe(true);
		});

		it('quem nunca tocou nas preferencias passa a receber', async () => {
			const user = fakeUser();
			UserModelMock.findById.mockReturnValue({
				lean: () => Promise.resolve(user),
			});

			await service.notify({
				userId: user._id,
				payload: {
					type: NotificationType.AllocationBreached,
					bucket: 'crypto',
					targetPct: 10,
					actualPct: 21,
				},
			});

			expect(emailSend).toHaveBeenCalledTimes(1);
			expect(pushSend).toHaveBeenCalledTimes(1);
		});
	});
});
