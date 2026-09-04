import { Inject, Injectable, Logger } from '@nestjs/common';
import {
	EMAIL_SENDER,
	EmailSender,
} from 'src/notifications/email/ports/email-sender.port';
import { User } from 'src/users/schema/user.model';
import {
	NotificationChannelName,
	NotificationPayload,
} from '../domain/notification.types';
import {
	NotificationChannel,
	NotificationChannelSendResult,
} from './notification-channel.port';
import { buildTemplate } from './notification-templates';

/**
 * Renderiza o template para HTML no mesmo estilo visual do EmailService
 * do digest (gradiente + CTA). Duplicado de proposito: o EmailService
 * hoje expoe metodos por caso de uso (welcome, reset, digest), nao um
 * `sendGeneric()`. Extrair um render base agora obriga refactor amplo em
 * EmailService — fora do escopo TRA-38.
 */
function renderHtml(tpl: ReturnType<typeof buildTemplate>, ctaUrl: string) {
	return `
		<div style="margin:0;padding:24px;background:#0b1220;font-family:Arial,sans-serif;color:#e5e7eb;">
			<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:16px;overflow:hidden;">
				<tr>
					<td style="padding:28px 28px 12px 28px;background:linear-gradient(135deg,#16a34a,#2563eb);">
						<div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#dcfce7;font-weight:700;">Trakker</div>
						<h1 style="margin:10px 0 0 0;color:#ffffff;font-size:24px;line-height:1.3;">${tpl.hero}</h1>
					</td>
				</tr>
				<tr>
					<td style="padding:24px 28px;">
						<h2 style="margin:0 0 12px 0;color:#f9fafb;font-size:18px;">${tpl.title}</h2>
						<p style="margin:0 0 20px 0;color:#d1d5db;font-size:14px;line-height:1.6;">${tpl.description}</p>
						<a href="${ctaUrl}" style="display:inline-block;padding:12px 18px;background:#22c55e;color:#052e16;text-decoration:none;font-weight:700;border-radius:10px;">
							${tpl.ctaLabel}
						</a>
						<p style="margin:20px 0 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">${tpl.footerNote}</p>
					</td>
				</tr>
			</table>
		</div>
	`;
}

@Injectable()
export class EmailNotificationChannel implements NotificationChannel {
	private readonly logger = new Logger(EmailNotificationChannel.name);

	constructor(@Inject(EMAIL_SENDER) private readonly sender: EmailSender) {}

	name(): NotificationChannelName {
		return NotificationChannelName.Email;
	}

	private baseUrl(): string {
		const raw =
			process.env.URL_PRODUCTION ||
			process.env.URL_DEVELOPMENT ||
			process.env.FRONTEND_URL ||
			'http://localhost:5173';
		return String(raw).replace(/\/+$/, '');
	}

	async send(
		user: User,
		payload: NotificationPayload
	): Promise<NotificationChannelSendResult> {
		if (!user.email) {
			return {
				channel: this.name(),
				success: false,
				error: 'user without email',
			};
		}

		const tpl = buildTemplate(payload);
		const ctaUrl = `${this.baseUrl()}${tpl.ctaPath}`;
		const html = renderHtml(tpl, ctaUrl);

		try {
			await this.sender.send({
				to: user.email,
				subject: tpl.subject,
				html,
				text: `${tpl.textFallback}\n\n${ctaUrl}`,
			});
			return { channel: this.name(), success: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(`Falha ao enviar email para ${user.email}: ${message}`);
			return {
				channel: this.name(),
				success: false,
				error: message,
			};
		}
	}
}
