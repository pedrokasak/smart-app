import { Inject, Injectable } from '@nestjs/common';
import { EmailService } from 'src/notifications/email/email.service';
import {
	MemberInviteNotifierPort,
	SendMemberInviteInput,
} from '../application/ports/member-invite-notifier.port';
import { memberInviteLink } from '../domain/team-rules';

/** Endereço do portal do assessor (`ADVISOR_WEB_URL`), ou null sem ele. */
export const ADVISOR_WEB_URL = Symbol('ADVISOR_WEB_URL');

/**
 * Monta o link do portal e manda o e-mail de convite para a equipe. Sem um
 * `ADVISOR_WEB_URL` http(s) válido lança antes de enviar (nenhum e-mail sai
 * com link quebrado). Não registra nada: token e e-mail nunca vão para log.
 */
@Injectable()
export class EmailMemberInviteNotifierAdapter implements MemberInviteNotifierPort {
	constructor(
		private readonly email: EmailService,
		@Inject(ADVISOR_WEB_URL) private readonly webUrl: string | null
	) {}

	async sendMemberInvite(input: SendMemberInviteInput): Promise<void> {
		await this.email.sendAdvisorTeamInviteEmail({
			to: input.to,
			inviteLink: memberInviteLink(this.portalBaseUrl(), input.token),
			orgName: input.orgName,
			expiresAt: input.expiresAt,
		});
	}

	private portalBaseUrl(): string {
		if (this.webUrl && /^https?:$/.test(protocolOf(this.webUrl))) {
			return this.webUrl;
		}
		throw new Error('ADVISOR_WEB_URL is not configured');
	}
}

function protocolOf(url: string): string {
	try {
		return new URL(url).protocol;
	} catch {
		return '';
	}
}
