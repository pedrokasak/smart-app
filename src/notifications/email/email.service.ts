import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_SENDER, EmailSender } from './ports/email-sender.port';

@Injectable()
export class EmailService {
	constructor(@Inject(EMAIL_SENDER) private readonly sender: EmailSender) {}

	private getAppBaseUrl(): string {
		return (
			process.env.URL_PRODUCTION ||
			process.env.URL_DEVELOPMENT ||
			'http://localhost:5173'
		);
	}

	private getBaseTemplate(params: {
		title: string;
		hero: string;
		description: string;
		ctaLabel: string;
		ctaUrl: string;
		footerNote: string;
	}): string {
		const { title, hero, description, ctaLabel, ctaUrl, footerNote } = params;
		return `
			<div style="margin:0;padding:24px;background:#0b1220;font-family:Arial,sans-serif;color:#e5e7eb;">
				<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:16px;overflow:hidden;">
					<tr>
						<td style="padding:28px 28px 12px 28px;background:linear-gradient(135deg,#16a34a,#2563eb);">
							<div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#dcfce7;font-weight:700;">Trakker</div>
							<h1 style="margin:10px 0 0 0;color:#ffffff;font-size:24px;line-height:1.3;">${hero}</h1>
						</td>
					</tr>
					<tr>
						<td style="padding:24px 28px;">
							<h2 style="margin:0 0 12px 0;color:#f9fafb;font-size:18px;">${title}</h2>
							<p style="margin:0 0 20px 0;color:#d1d5db;font-size:14px;line-height:1.6;">${description}</p>
							<a href="${ctaUrl}" style="display:inline-block;padding:12px 18px;background:#22c55e;color:#052e16;text-decoration:none;font-weight:700;border-radius:10px;">
								${ctaLabel}
							</a>
							<p style="margin:20px 0 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">${footerNote}</p>
						</td>
					</tr>
				</table>
			</div>
		`;
	}

	async sendPasswordResetEmail(email: string, token: string): Promise<void> {
		const resetLink = `${this.getAppBaseUrl()}/reset-password?token=${token}`;

		const subject = 'Redefinição de Senha - Trakker';
		const html = this.getBaseTemplate({
			title: 'Recuperação de senha',
			hero: 'Solicitação para redefinir sua senha',
			description:
				'Recebemos um pedido para alterar sua senha. Clique no botão abaixo para criar uma nova senha com segurança.',
			ctaLabel: 'Redefinir minha senha',
			ctaUrl: resetLink,
			footerNote:
				'Este link expira em 1 hora. Se você não solicitou, ignore este email com segurança.',
		});
		const text = `Recuperação de Senha - Trakker\n\nVocê solicitou a redefinição da sua senha.\nAcesse: ${resetLink}\n\nEste link expira em 1 hora.\nSe não foi você, ignore este email.`;

		await this.sender.send({
			to: email,
			subject,
			html,
			text,
		});
	}

	async sendWelcomeEmail(email: string, firstName?: string): Promise<void> {
		const dashboardLink = `${this.getAppBaseUrl()}/dashboard`;
		const safeName = String(firstName || 'Investidor').trim();
		const subject = `Bem-vindo(a) ao Trakker, ${safeName}!`;
		const html = this.getBaseTemplate({
			title: `Conta criada com sucesso, ${safeName}!`,
			hero: 'Seu novo painel de investimentos está pronto',
			description:
				'Obrigado por se cadastrar no Trakker. Agora você já pode conectar suas contas, importar sua carteira e acompanhar seus resultados em tempo real.',
			ctaLabel: 'Acessar meu dashboard',
			ctaUrl: dashboardLink,
			footerNote:
				'Dica: ative a autenticação em dois fatores para aumentar a segurança da sua conta.',
		});
		const text = `Bem-vindo(a) ao Trakker, ${safeName}!\n\nSua conta foi criada com sucesso.\nAcesse seu dashboard: ${dashboardLink}\n\nBons investimentos!`;

		await this.sender.send({
			to: email,
			subject,
			html,
			text,
		});
	}
}
