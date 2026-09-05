import { Test, TestingModule } from '@nestjs/testing';
import { EmailNotificationChannel } from './email-notification.channel';
import { EMAIL_SENDER } from 'src/notifications/email/ports/email-sender.port';
import { NotificationType } from '../domain/notification.types';

describe('EmailNotificationChannel', () => {
	let channel: EmailNotificationChannel;
	const sender = { send: jest.fn().mockResolvedValue(undefined) };

	beforeEach(async () => {
		jest.clearAllMocks();
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				EmailNotificationChannel,
				{ provide: EMAIL_SENDER, useValue: sender },
			],
		}).compile();
		channel = module.get(EmailNotificationChannel);
	});

	it('envia email com subject construido do template', async () => {
		const result = await channel.send({ email: 'x@y.com' } as any, {
			type: NotificationType.DividendReceived,
			symbol: 'PETR4',
			amount: 100,
		});
		expect(result.success).toBe(true);
		expect(sender.send).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'x@y.com',
				subject: expect.stringContaining('PETR4'),
				html: expect.stringContaining('PETR4'),
			})
		);
	});

	it('recusa quando usuario nao tem email', async () => {
		const result = await channel.send({ email: undefined } as any, {
			type: NotificationType.DividendReceived,
			symbol: 'PETR4',
			amount: 1,
		});
		expect(result.success).toBe(false);
		expect(sender.send).not.toHaveBeenCalled();
	});

	it('captura excecao do sender e devolve success=false', async () => {
		sender.send.mockRejectedValueOnce(new Error('boom'));
		const result = await channel.send({ email: 'x@y.com' } as any, {
			type: NotificationType.DividendReceived,
			symbol: 'PETR4',
			amount: 1,
		});
		expect(result.success).toBe(false);
		expect(result.error).toBe('boom');
	});
});
