import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_SENDER, EmailSender } from './ports/email-sender.port';

@Injectable()
export class EmailService {
	constructor(@Inject(EMAIL_SENDER) private readonly sender: EmailSender) {}

	async sendPasswordResetEmail(email: string, token: string): Promise<void> {
		const resetLink = `${process.env.URL_DEVELOPMENT || 'http://localhost:5173'}/reset-password?token=${token}`;

		const subject = 'Redefinição de Senha - Trakker';
		const html = `
			<h1>Recuperação de Senha</h1>
			<p>Você solicitou a redefinição da sua senha. Clique no link abaixo para prosseguir:</p>
			<a href="${resetLink}">Redefinir minha senha</a>
			<p>Este link expira em 1 hora.</p>
			<p>Se você não solicitou isso, por favor ignore este email.</p>
		`;
		const text = `Recuperação de Senha\n\nVocê solicitou a redefinição da sua senha.\nAcesse: ${resetLink}\n\nEste link expira em 1 hora.\nSe você não solicitou isso, por favor ignore este email.`;

		await this.sender.send({
			to: email,
			subject,
			html,
			text,
		});
	}
}
