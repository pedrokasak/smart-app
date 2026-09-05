import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PushSubscriptionsService } from './push-subscriptions.service';

const ALICE = new Types.ObjectId().toString();

describe('PushSubscriptionsService', () => {
	const repository = {
		upsert: jest.fn(),
		removeForUser: jest.fn(),
		findByUser: jest.fn(),
		findByUsers: jest.fn(),
		deleteByEndpoint: jest.fn(),
		registerFailure: jest.fn(),
		registerSuccess: jest.fn(),
	};

	const sender = {
		isEnabled: jest.fn().mockReturnValue(true),
		publicKey: jest.fn().mockReturnValue('BPUBLIC'),
		send: jest.fn(),
	};

	const service = new PushSubscriptionsService(
		repository as any,
		sender as any
	);

	beforeEach(() => jest.clearAllMocks());

	it('serve a chave publica vinda do sender (rotacao sem redeploy do web)', () => {
		sender.publicKey.mockReturnValue('BPUBLIC');
		expect(service.vapidPublicKey()).toEqual({ publicKey: 'BPUBLIC' });
	});

	it('com push desligado devolve string vazia em vez de estourar', () => {
		sender.publicKey.mockReturnValue('');
		expect(service.vapidPublicKey()).toEqual({ publicKey: '' });
	});

	it('registrar duas vezes o mesmo endpoint e um upsert, nunca um insert novo', async () => {
		const input = {
			endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
			keys: { p256dh: 'p', auth: 'a' },
			userAgent: 'Chrome',
		};

		await service.register(ALICE, input);
		await service.register(ALICE, input);

		expect(repository.upsert).toHaveBeenCalledTimes(2);
		for (const call of repository.upsert.mock.calls) {
			expect(call[0].endpoint).toBe(input.endpoint);
			expect(String(call[0].userId)).toBe(ALICE);
		}
	});

	it('o dono vem sempre do token, nunca do corpo', async () => {
		await service.register(ALICE, {
			endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
			keys: { p256dh: 'p', auth: 'a' },
		});

		expect(String(repository.upsert.mock.calls[0][0].userId)).toBe(ALICE);
	});

	it('remover leva o usuario no filtro — ninguem apaga assinatura alheia', async () => {
		repository.removeForUser.mockResolvedValue(0);

		await service.unregister(ALICE, 'https://fcm.googleapis.com/fcm/send/bob');

		const [userId, endpoint] = repository.removeForUser.mock.calls[0];
		expect(String(userId)).toBe(ALICE);
		expect(endpoint).toBe('https://fcm.googleapis.com/fcm/send/bob');
	});

	it('remover endpoint desconhecido responde normalmente (idempotente, sem 404)', async () => {
		repository.removeForUser.mockResolvedValue(0);
		await expect(
			service.unregister(ALICE, 'https://x/desconhecido')
		).resolves.toEqual({ removed: false });
	});

	it('remover o proprio endpoint reporta a remocao', async () => {
		repository.removeForUser.mockResolvedValue(1);
		await expect(service.unregister(ALICE, 'https://x/meu')).resolves.toEqual({
			removed: true,
		});
	});

	it('token sem id utilizavel nao vira consulta com filtro vazio', async () => {
		await expect(service.unregister('', 'https://x/y')).rejects.toBeInstanceOf(
			BadRequestException
		);
		expect(repository.removeForUser).not.toHaveBeenCalled();
	});
});
