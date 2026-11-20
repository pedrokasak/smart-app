import { Logger } from '@nestjs/common';
import { EmailService } from 'src/notifications/email/email.service';
import { EmailInviteNotifierAdapter } from './email-invite-notifier.adapter';

describe('EmailInviteNotifierAdapter', () => {
	const input = {
		to: 'cliente@example.com',
		token: 'secret-token',
		orgName: 'Acme',
		expiresAt: new Date('2030-06-15T12:00:00Z'),
	};

	function build() {
		const email = {
			sendAdvisorInviteEmail: jest.fn().mockResolvedValue(undefined),
		};
		const adapter = new EmailInviteNotifierAdapter(
			email as unknown as EmailService
		);
		return { adapter, email };
	}

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('calls the e-mail service once with the invite data', async () => {
		const { adapter, email } = build();

		await adapter.sendInvite(input);

		expect(email.sendAdvisorInviteEmail).toHaveBeenCalledTimes(1);
		expect(email.sendAdvisorInviteEmail).toHaveBeenCalledWith({
			to: input.to,
			token: input.token,
			orgName: input.orgName,
			expiresAt: input.expiresAt,
		});
	});

	it('propagates a delivery failure', async () => {
		const { adapter, email } = build();
		email.sendAdvisorInviteEmail.mockRejectedValue(new Error('provider down'));

		await expect(adapter.sendInvite(input)).rejects.toThrow('provider down');
	});

	it('never logs the token or the e-mail', async () => {
		const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
			(level) => jest.spyOn(Logger.prototype, level).mockImplementation()
		);
		const { adapter, email } = build();
		await adapter.sendInvite(input);
		email.sendAdvisorInviteEmail.mockRejectedValue(new Error('provider down'));
		await adapter.sendInvite(input).catch(() => undefined);

		const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
		expect(logged).not.toContain(input.token);
		expect(logged).not.toContain(input.to);
	});
});
