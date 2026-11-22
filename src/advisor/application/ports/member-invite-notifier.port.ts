export const ADVISOR_MEMBER_INVITE_NOTIFIER = Symbol(
	'ADVISOR_MEMBER_INVITE_NOTIFIER'
);

export interface SendMemberInviteInput {
	to: string;
	token: string;
	orgName: string;
	expiresAt: Date;
}

export interface MemberInviteNotifierPort {
	/**
	 * Envia o e-mail com o link do portal do assessor. Lança se o envio falhar
	 * ou se não houver endereço do portal para montar o link.
	 */
	sendMemberInvite(input: SendMemberInviteInput): Promise<void>;
}
