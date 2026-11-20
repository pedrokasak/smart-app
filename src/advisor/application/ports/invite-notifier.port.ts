export const ADVISOR_INVITE_NOTIFIER = Symbol('ADVISOR_INVITE_NOTIFIER');

export interface SendInviteInput {
	to: string;
	token: string;
	orgName: string;
	expiresAt: Date;
}

export interface InviteNotifierPort {
	/** Envia o e-mail com o link. Lança se o envio falhar. */
	sendInvite(input: SendInviteInput): Promise<void>;
}
