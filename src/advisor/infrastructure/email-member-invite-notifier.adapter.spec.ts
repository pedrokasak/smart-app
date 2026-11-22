import { Logger } from '@nestjs/common';
import { EmailService } from 'src/notifications/email/email.service';
import { EmailMemberInviteNotifierAdapter } from './email-member-invite-notifier.adapter';

describe('EmailMemberInviteNotifierAdapter', () => {
	const input = {
		to: 'assessor@example.com',
		token: 'secret-token',
		orgName: 'Acme',
		expiresAt: new Date('2030-06-15T12:00:00Z'),
	};

	function build(webUrl: string | null = 'https://assessor.example.com/') {
		const email = {
			sendAdvisorTeamInviteEmail: jest.fn().mockResolvedValue(undefined),
		};
		const adapter = new EmailMemberInviteNotifierAdapter(
			email as unknown as EmailService,
			webUrl
		);
		return { adapter, email };
	}

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('envia o link do portal com o token só depois de #', async () => {
		const { adapter, email } = build();

		await adapter.sendMemberInvite(input);

		expect(email.sendAdvisorTeamInviteEmail).toHaveBeenCalledTimes(1);
		expect(email.sendAdvisorTeamInviteEmail).toHaveBeenCalledWith({
			to: input.to,
			inviteLink:
				'https://assessor.example.com/convite-equipe#token=secret-token',
			orgName: input.orgName,
			expiresAt: input.expiresAt,
		});
		const { inviteLink } = email.sendAdvisorTeamInviteEmail.mock.calls[0][0];
		const [beforeHash] = inviteLink.split('#');
		expect(beforeHash).not.toContain(input.token);
	});

	it.each([null, '', 'assessor.example.com', 'javascript:alert(1)'])(
		'sem ADVISOR_WEB_URL válido (%p) lança e não envia nada',
		async (webUrl) => {
			const { adapter, email } = build(webUrl);

			await expect(adapter.sendMemberInvite(input)).rejects.toThrow(
				'ADVISOR_WEB_URL is not configured'
			);
			expect(email.sendAdvisorTeamInviteEmail).not.toHaveBeenCalled();
		}
	);

	it('propaga a falha do envio', async () => {
		const { adapter, email } = build();
		email.sendAdvisorTeamInviteEmail.mockRejectedValue(
			new Error('provider down')
		);

		await expect(adapter.sendMemberInvite(input)).rejects.toThrow(
			'provider down'
		);
	});

	it('nunca registra o token nem o e-mail', async () => {
		const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
			(level) => jest.spyOn(Logger.prototype, level).mockImplementation()
		);
		const { adapter, email } = build();
		await adapter.sendMemberInvite(input);
		email.sendAdvisorTeamInviteEmail.mockRejectedValue(
			new Error('provider down')
		);
		await adapter.sendMemberInvite(input).catch(() => undefined);
		await build(null)
			.adapter.sendMemberInvite(input)
			.catch(() => undefined);

		const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
		expect(logged).not.toContain(input.token);
		expect(logged).not.toContain(input.to);
	});
});
