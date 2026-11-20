import { Injectable } from '@nestjs/common';
import { EmailService } from 'src/notifications/email/email.service';
import {
	InviteNotifierPort,
	SendInviteInput,
} from '../application/ports/invite-notifier.port';

/**
 * Só mapeia o port para o e-mail de convite. Não registra nada: o token e o
 * e-mail do convidado não podem aparecer em log. Falha de envio propaga.
 */
@Injectable()
export class EmailInviteNotifierAdapter implements InviteNotifierPort {
	constructor(private readonly email: EmailService) {}

	async sendInvite(input: SendInviteInput): Promise<void> {
		await this.email.sendAdvisorInviteEmail({
			to: input.to,
			token: input.token,
			orgName: input.orgName,
			expiresAt: input.expiresAt,
		});
	}
}
