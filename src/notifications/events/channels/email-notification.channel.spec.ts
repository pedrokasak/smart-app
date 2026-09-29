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

	// TRA-261: o aviso de RI traz texto de fora (titulo entregue a CVM,
	// destaques de IA). Nada disso pode virar HTML no e-mail.
	it('escapa o texto do template e mostra o link da fonte', async () => {
		await channel.send({ email: 'x@y.com' } as any, {
			type: NotificationType.RiMaterialFact,
			ticker: 'PETR4',
			company: 'Petrobras',
			title: 'Aquisição <script>alert(1)</script> & "outros"',
			publishedAt: '2026-09-28T00:00:00.000Z',
			sourceUrl:
				'https://www.rad.cvm.gov.br/ENETWeb/frmDownloadDocumento.aspx?Tela=ext&numProtocolo=1571942',
		});

		const { html, text } = sender.send.mock.calls[0][0];
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).toContain('&amp; &quot;outros&quot;');
		expect(html).toContain(
			'href="https://www.rad.cvm.gov.br/ENETWeb/frmDownloadDocumento.aspx?Tela=ext&amp;numProtocolo=1571942"'
		);
		expect(html).toContain('Abrir o documento na CVM');
		expect(text).toContain('numProtocolo=1571942');
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
